// Suggest stage: alternative rewrites + common ground. One call on the premium
// model — the single "think hard once" step of the pipeline. Consumes the
// cluster analysis (consensus/division/bridging/profiles/minority) plus the
// verdict's triggers and safe version.

import { generateText, type LanguageModel, Output } from "ai";
import { z } from "zod";
import { ANALYSIS_TEMPERATURE, stageTimeoutSignal } from "../models/stages";
import { suggestPrompts } from "../prompts/suggest";
import { severitySchema } from "../schemas";
import type {
  AlternativeSuggestions,
  FlameResult,
  OpinionClusterResult,
  OutputLang,
} from "../types";
import { clampPromptInput } from "../util/sanitize";

const suggestGenSchema = z.object({
  alternatives: z
    .array(
      z.object({
        text: z.string(),
        strategy: z.string(),
        targetTriggers: z.array(z.number().int().min(0)),
        estimatedRiskReduction: severitySchema,
        reasoning: z.string(),
      }),
    )
    .min(2)
    .max(4),
  commonGround: z.string(),
});

export type SuggestOptions = {
  topic: string;
  cluster: OpinionClusterResult;
  verdict: FlameResult;
  outputLang: OutputLang;
  model: LanguageModel;
};

export async function suggestAlternatives(opts: SuggestOptions): Promise<AlternativeSuggestions> {
  const topic = clampPromptInput(opts.topic);
  const { system, prompt } = suggestPrompts({
    topic,
    cluster: opts.cluster,
    verdict: opts.verdict,
    outputLang: opts.outputLang,
  });

  const { output } = await generateText({
    model: opts.model,
    temperature: ANALYSIS_TEMPERATURE,
    abortSignal: stageTimeoutSignal("suggest"),
    output: Output.object({ schema: suggestGenSchema }),
    system,
    prompt,
  });

  const maxTrigger = opts.verdict.triggers.length - 1;
  return {
    alternatives: output.alternatives.map((a, i) => ({
      id: `alt-${i + 1}`,
      text: a.text,
      strategy: a.strategy,
      // The schema can't know the trigger count; clamp out-of-range references.
      targetTriggers: a.targetTriggers.filter((t) => t >= 0 && t <= maxTrigger),
      estimatedRiskReduction: a.estimatedRiskReduction,
      reasoning: a.reasoning,
    })),
    commonGround: output.commonGround,
  };
}
