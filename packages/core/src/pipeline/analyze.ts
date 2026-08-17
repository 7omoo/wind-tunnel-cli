// Analyze stage, split for arbitrary N (docs/DESIGN.md §4):
//
//   1. scoreOpinions — per-opinion sentiment scores in batches on the bulk
//      model. Each opinion is independent, so this scales to any N and rides
//      the same wave executor as the react stage.
//   2. analyzeVerdict — ONE call on the analysis model: backlash index,
//      triggers, safe version. It sees aggregate statistics from step 1 plus a
//      stratified sample of raw reactions that fits the stage's context budget.
//
// All JSON comes back through constrained decoding (Output.object -> Ollama
// `format`), so the generation schemas here are strict — no .catch/.default.

import { generateText, type LanguageModel, Output } from "ai";
import { z } from "zod";
import { averageScore, percentages, sentimentCounts } from "../analysis/scoring";
import { outputLangName } from "../schemas";
import type { FlameResult, Opinion, OpinionScore, OutputLang, Trigger } from "../types";
import { sanitizePromptInput } from "../util/sanitize";
import { mapWaves } from "./batch";
import { type ScoredOpinion, stratifiedSample } from "./sample";

export const SCORE_BATCH_SIZE = 25;

// === 1. Per-opinion scores (bulk model, batched) ===

export type ScoreOptions = {
  topic: string;
  opinions: Opinion[];
  outputLang: OutputLang;
  model: LanguageModel;
  concurrency: number;
  batchSize?: number;
  onProgress?: (done: number, total: number) => void;
};

export type ScoreResult = { scores: OpinionScore[]; warnings: string[] };

export async function scoreOpinions(opts: ScoreOptions): Promise<ScoreResult> {
  const topic = sanitizePromptInput(opts.topic);
  const batchSize = opts.batchSize ?? SCORE_BATCH_SIZE;
  const lang = outputLangName(opts.outputLang);
  const batches: Opinion[][] = [];
  for (let i = 0; i < opts.opinions.length; i += batchSize) {
    batches.push(opts.opinions.slice(i, i + batchSize));
  }

  const system = `You are a sentiment scorer for public reactions to a post/ad. Score EVERY reaction from -100 (most critical/hostile) to +100 (most favorable/supportive), 0 = neutral, with a one-sentence reason in ${lang}.`;

  const settled = await mapWaves(
    batches,
    opts.concurrency,
    async (batch) => {
      const ids = batch.map((o) => o.personaId);
      // Constrained decoding pins personaId to the exact ids of this batch and
      // forces one entry per reaction.
      const schema = z.object({
        scores: z
          .array(
            z.object({
              personaId: z.enum(ids as [string, ...string[]]),
              score: z.number().min(-100).max(100),
              reason: z.string(),
            }),
          )
          .length(batch.length),
      });
      const reactionsBlock = batch.map((o) => `[${o.personaId}] ${o.text}`).join("\n");
      const { output } = await generateText({
        model: opts.model,
        temperature: 0.1,
        output: Output.object({ schema }),
        system,
        prompt: `Post content: ${topic}\n\nReactions:\n${reactionsBlock}\n\nScore every reaction.`,
      });
      return output.scores;
    },
    opts.onProgress,
  );

  const byId = new Map<string, OpinionScore>();
  const warnings: string[] = [];
  let failedBatches = 0;
  settled.forEach((result, i) => {
    if (result.status === "fulfilled") {
      for (const s of result.value) {
        byId.set(s.personaId, s);
      }
    } else {
      failedBatches++;
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
      warnings.push(`score batch ${i + 1}/${batches.length} failed: ${reason}`);
    }
  });
  if (failedBatches === batches.length && batches.length > 0) {
    throw new Error(`all ${batches.length} score batches failed`);
  }

  // Opinions from failed batches (or ids the model still missed) score 0 so
  // downstream stats stay complete; the gap is reported, not hidden.
  let defaulted = 0;
  const scores = opts.opinions.map((o) => {
    const s = byId.get(o.personaId);
    if (s) return s;
    defaulted++;
    return { personaId: o.personaId, score: 0, reason: "" };
  });
  if (defaulted > 0) warnings.push(`${defaulted} opinions defaulted to score 0`);

  // Ascending (most critical first) — the order every consumer expects.
  scores.sort((a, b) => a.score - b.score);
  return { scores, warnings };
}

// === 2. Verdict (analysis model, one call on a budgeted sample) ===

const verdictGenSchema = z.object({
  inflammationIndex: z.number().min(0).max(100),
  riskLevel: z.enum(["Low", "Medium", "High", "Critical"]),
  summary: z.string(),
  triggers: z
    .array(
      z.object({
        expression: z.string(),
        offendedSegment: z.string(),
        severity: z.enum(["High", "Medium", "Low"]),
        count: z.number().min(0),
        sampleOpinionIds: z.array(z.string()),
      }),
    )
    .max(8),
  safeVersion: z.string(),
});

export type VerdictOptions = {
  topic: string;
  opinions: Opinion[];
  scores: OpinionScore[];
  outputLang: OutputLang;
  model: LanguageModel;
  // Sample budgets; defaults reproduce "everything" for typical N (docs/DESIGN.md §4).
  sampleMaxCount?: number;
  sampleMaxChars?: number;
  random?: () => number;
};

export async function analyzeVerdict(opts: VerdictOptions): Promise<FlameResult> {
  const topic = sanitizePromptInput(opts.topic);
  const ja = opts.outputLang === "ja";
  const langName = outputLangName(opts.outputLang);

  const scoreById = new Map(opts.scores.map((s) => [s.personaId, s.score]));
  const scored: ScoredOpinion[] = opts.opinions.map((o) => ({
    opinion: o,
    score: scoreById.get(o.personaId) ?? 0,
  }));
  const sample = stratifiedSample(scored, {
    maxCount: opts.sampleMaxCount ?? 150,
    maxChars: opts.sampleMaxChars ?? 60000,
    random: opts.random,
  });

  const counts = sentimentCounts(opts.scores);
  const pct = percentages(counts, opts.scores.length);
  const avg = averageScore(opts.scores);
  const statsBlock = ja
    ? `全 ${opts.scores.length} 件の反応の集計: 批判的 ${counts.critical} 件 (${pct.critical}%) / 中立 ${counts.neutral} 件 (${pct.neutral}%) / 好意的 ${counts.favorable} 件 (${pct.favorable}%)。平均スコア ${avg} (-100〜+100)。`
    : `Aggregate over all ${opts.scores.length} reactions: critical ${counts.critical} (${pct.critical}%), neutral ${counts.neutral} (${pct.neutral}%), favorable ${counts.favorable} (${pct.favorable}%). Mean score ${avg} on -100..+100.`;
  const sampleNote =
    sample.length < opts.opinions.length
      ? ja
        ? `以下は全 ${opts.opinions.length} 件から層化抽出した ${sample.length} 件 (批判的な端・好意的な端を重点、スコア昇順)。`
        : `Below is a stratified sample of ${sample.length} out of ${opts.opinions.length} reactions (weighted toward both extremes, sorted by score ascending).`
      : ja
        ? `以下は全 ${sample.length} 件の反応 (スコア昇順)。`
        : `Below are all ${sample.length} reactions (sorted by score ascending).`;

  const reactionsBlock = sample
    .map((s) => `[${s.opinion.personaId}] (score ${s.score}) ${s.opinion.text}`)
    .join("\n");

  const system = ja
    ? `あなたは炎上リスク分析の専門家です。投稿・広告文への反応から炎上リスクを評価します。すべて日本語で出力してください。`
    : `You are an expert in backlash risk analysis. Assess the risk of public backlash from reactions to a post/ad. Output everything in ${langName}.`;
  const instructions = ja
    ? `評価の指針:
- inflammationIndex: 0-100 の炎上指数 (0=安全、100=炎上確実)。集計統計と反応の内容の両方を根拠にすること
- triggers: 何が・誰を不快にさせるか。expression は問題の表現、offendedSegment は不快に感じる層、sampleOpinionIds は根拠となる反応の personaId
- safeVersion: 元の意図を保ちつつ炎上リスクを下げた修正版`
    : `Guidance:
- inflammationIndex: 0-100 backlash index (0=safe, 100=certain backlash), grounded in both the aggregate statistics and the reactions
- triggers: what offends whom. expression = the problematic wording, offendedSegment = who it offends, sampleOpinionIds = personaIds of supporting reactions
- safeVersion: a revision that preserves the original intent while lowering the risk`;

  const { output } = await generateText({
    model: opts.model,
    temperature: 0.1,
    output: Output.object({ schema: verdictGenSchema }),
    system,
    prompt: `${ja ? "投稿内容" : "Post content"}: ${topic}\n\n${statsBlock}\n\n${sampleNote}\n${reactionsBlock}\n\n${instructions}`,
  });

  // triggerAssignment: personaId -> trigger index, for coloring reactions.
  const triggers: Trigger[] = output.triggers;
  const triggerAssignment: Record<string, number> = {};
  triggers.forEach((t, idx) => {
    for (const id of t.sampleOpinionIds) triggerAssignment[id] = idx;
  });

  return {
    inflammationIndex: output.inflammationIndex,
    riskLevel: output.riskLevel,
    summary: output.summary,
    triggers,
    safeVersion: output.safeVersion,
    opinionScores: opts.scores,
    triggerAssignment,
  };
}
