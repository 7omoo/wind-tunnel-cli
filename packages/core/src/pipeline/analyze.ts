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
import { averageScore, sentimentCounts } from "../analysis/scoring";
import { ANALYSIS_TEMPERATURE, stageTimeoutSignal } from "../models/stages";
import { scoreSystemPrompt, scoreUserPrompt, verdictPrompts } from "../prompts/analyze";
import { riskLevelSchema, severitySchema } from "../schemas";
import type { FlameResult, Opinion, OpinionScore, OutputLang, Trigger } from "../types";
import { clampPromptInput } from "../util/sanitize";
import { chunk, mapWaves } from "./batch";
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
  const topic = clampPromptInput(opts.topic);
  const batchSize = opts.batchSize ?? SCORE_BATCH_SIZE;
  const batches = chunk(opts.opinions, batchSize);

  // The model never writes a signed number. Small local models mis-sign
  // negative ranges (observed: reasons saying "clear criticism" scored +25),
  // so the schema takes a stance enum plus an unsigned intensity and the sign
  // is composed in code — a sign error is structurally impossible.
  const system = scoreSystemPrompt(opts.outputLang);

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
              stance: z.enum(["critical", "neutral", "favorable"]),
              intensity: z.number().min(0).max(100),
              reason: z.string(),
            }),
          )
          .length(batch.length),
      });
      const { output } = await generateText({
        model: opts.model,
        temperature: ANALYSIS_TEMPERATURE,
        output: Output.object({ schema }),
        system,
        prompt: scoreUserPrompt(topic, batch),
        abortSignal: stageTimeoutSignal("score"),
      });
      // Compose the signed score. Non-neutral intensities clamp to [20, 100] so
      // the stance always lands in its sentiment band (threshold ±20).
      return output.scores.map((s) => ({
        personaId: s.personaId,
        score:
          s.stance === "neutral"
            ? 0
            : (s.stance === "critical" ? -1 : 1) * Math.min(100, Math.max(20, s.intensity)),
        reason: s.reason,
      }));
    },
    opts.onProgress,
  );

  const byId = new Map<string, OpinionScore>();
  const warnings: string[] = [];
  let failedBatches = 0;
  let lastFailure: unknown;
  settled.forEach((result, i) => {
    if (result.status === "fulfilled") {
      for (const s of result.value) {
        byId.set(s.personaId, s);
      }
    } else {
      failedBatches++;
      lastFailure = result.reason;
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
      warnings.push(`score batch ${i + 1}/${batches.length} failed: ${reason}`);
    }
  });
  if (failedBatches === batches.length && batches.length > 0) {
    // cause preserved so the CLI error classifier can see the network layer.
    throw new Error(`all ${batches.length} score batches failed`, { cause: lastFailure });
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
  riskLevel: riskLevelSchema,
  summary: z.string(),
  triggers: z
    .array(
      z.object({
        expression: z.string(),
        offendedSegment: z.string(),
        severity: severitySchema,
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
  const topic = clampPromptInput(opts.topic);

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

  const { system, prompt } = verdictPrompts({
    topic,
    outputLang: opts.outputLang,
    stats: {
      total: opts.scores.length,
      counts: sentimentCounts(opts.scores),
      average: averageScore(opts.scores),
    },
    opinionCount: opts.opinions.length,
    sample,
  });

  const { output } = await generateText({
    model: opts.model,
    temperature: ANALYSIS_TEMPERATURE,
    abortSignal: stageTimeoutSignal("verdict"),
    output: Output.object({ schema: verdictGenSchema }),
    system,
    prompt,
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
