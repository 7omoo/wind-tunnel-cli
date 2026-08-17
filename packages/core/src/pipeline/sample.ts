// Stratified sampling for the whole-corpus analysis stages (verdict,
// proposition extraction). Local models cap the context, so above a threshold
// the analyzer sees a sample instead of every reaction — weighted toward the
// extremes (that's where triggers live), with a random slice of the middle so
// the sample doesn't caricature the crowd. At N <= maxCount and within the
// char budget the "sample" is simply everything, reproducing small-N behavior.

import type { Opinion } from "../types";

export type ScoredOpinion = { opinion: Opinion; score: number };

export type StratifiedSampleOptions = {
  // Hard cap on sampled items. Default matches docs/DESIGN.md §4 (~150 = "all"
  // for typical runs).
  maxCount: number;
  // Char budget across sampled opinion texts, protecting the num_ctx budget of
  // the stage that embeds them.
  maxChars: number;
  // Injectable RNG for deterministic tests.
  random?: () => number;
};

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
    const nCritical = Math.ceil(target * 0.4);
    const nFavorable = Math.ceil(target * 0.3);
    const nNeutral = Math.max(0, target - nCritical - nFavorable);

    const critical = sorted.slice(0, nCritical);
    const favorable = nFavorable > 0 ? sorted.slice(-nFavorable) : [];
    const middle = sorted.slice(nCritical, sorted.length - favorable.length);
    const neutral = shuffleWith(middle, random).slice(0, nNeutral);

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

function shuffleWith<T>(arr: T[], random: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const ai = a[i] as T;
    a[i] = a[j] as T;
    a[j] = ai;
  }
  return a;
}
