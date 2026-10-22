// Stratified sampling for the whole-corpus analysis stages (verdict,
// proposition extraction). Local models cap the context, so above a threshold
// the analyzer sees a sample instead of every reaction — weighted toward the
// extremes (that's where triggers live), with a random slice of the middle so
// the sample doesn't caricature the crowd. At N <= maxCount and within the
// char budget the "sample" is simply everything, reproducing small-N behavior.

import type { Opinion, OpinionScore } from "../types";
import { shuffle } from "../util/shuffle";

export type ScoredOpinion = { opinion: Opinion; score: number };

export type StratifiedSampleOptions = {
  // Hard cap on sampled items.
  maxCount: number;
  // Char budget across sampled opinion texts, protecting the num_ctx budget of
  // the stage that embeds them.
  maxChars: number;
  // Injectable RNG for deterministic tests.
  random?: () => number;
};

// Budget of the whole-corpus analysis calls (verdict, propositions): ~150
// reactions is "all" for typical runs and fits the stage's context window
// (docs/DESIGN.md §4).
export const ANALYSIS_SAMPLE = { maxCount: 150, maxChars: 60000 };

// Joins opinions with their scores (unscored -> 0) and draws the analysis
// sample within ANALYSIS_SAMPLE, unless overridden.
export function sampleForAnalysis(
  opinions: Opinion[],
  scores: Pick<OpinionScore, "personaId" | "score">[],
  opts: Partial<StratifiedSampleOptions> = {},
): ScoredOpinion[] {
  const scoreById = new Map(scores.map((s) => [s.personaId, s.score]));
  const scored = opinions.map((o) => ({ opinion: o, score: scoreById.get(o.personaId) ?? 0 }));
  return stratifiedSample(scored, {
    maxCount: opts.maxCount ?? ANALYSIS_SAMPLE.maxCount,
    maxChars: opts.maxChars ?? ANALYSIS_SAMPLE.maxChars,
    random: opts.random,
  });
}

// Returns items sorted by score ascending (most critical first).
export function stratifiedSample(
  items: ScoredOpinion[],
  opts: StratifiedSampleOptions,
): ScoredOpinion[] {
  const random = opts.random ?? Math.random;
  const sorted = [...items].sort((a, b) => a.score - b.score);

  const totalChars = sorted.reduce((sum, s) => sum + s.opinion.text.length, 0);
  let picked: ScoredOpinion[];
  if (sorted.length <= opts.maxCount && totalChars <= opts.maxChars) {
    picked = sorted;
  } else {
    const target = Math.min(opts.maxCount, sorted.length);
    // 40% most critical, 30% most favorable, 30% random from the middle.
    // Rounding both shares up can overshoot a tiny target (1 -> 1 + 1), so the
    // favorable share takes only what the critical one left.
    const nCritical = Math.ceil(target * 0.4);
    const nFavorable = Math.min(Math.ceil(target * 0.3), target - nCritical);
    const nNeutral = Math.max(0, target - nCritical - nFavorable);

    const critical = sorted.slice(0, nCritical);
    const favorable = nFavorable > 0 ? sorted.slice(-nFavorable) : [];
    const middle = sorted.slice(nCritical, sorted.length - favorable.length);
    const neutral = shuffle(middle, random).slice(0, nNeutral);

    picked = [...critical, ...neutral, ...favorable].sort((a, b) => a.score - b.score);
  }

  // Enforce the char budget: drop from the middle outward so the extremes
  // (the trigger evidence) survive the longest. Always keep at least 3.
  let chars = picked.reduce((sum, s) => sum + s.opinion.text.length, 0);
  while (chars > opts.maxChars && picked.length > 3) {
    const dropIndex = Math.floor(picked.length / 2);
    const [dropped] = picked.splice(dropIndex, 1);
    chars -= dropped ? dropped.opinion.text.length : 0;
  }
  return picked;
}
