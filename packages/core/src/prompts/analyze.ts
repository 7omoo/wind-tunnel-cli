// Prompts for the analyze stage (pipeline/analyze.ts): per-opinion scoring on
// the bulk model, then the verdict on the analysis model. The stage owns the
// generation schemas and the logic; this module owns the wording.

import { outputLangName } from "../schemas";
import type { Opinion, OutputLang } from "../types";
import { postContentBlock } from "./post";

// === Scoring (bulk model, batched) ===

// Calibration ("boredom is not backlash"): dismissive/bored/pointless
// reactions are neutral, not critical; without that, harmless-but-bland posts
// saturate the verdict (observed: a weather question at 95/100 HIGH).
export function scoreSystemPrompt(outputLang: OutputLang): string {
  const lang = outputLangName(outputLang);
  return `You are a sentiment scorer for public reactions to a post/ad. For EVERY reaction, classify its stance toward the post and rate the intensity, with a one-sentence reason in ${lang}.
- stance "critical": the reaction criticizes, objects to, or is offended by the post
- stance "neutral": indifferent, bored, ambivalent, or "this is pointless" — dismissiveness is NOT criticism
- stance "favorable": the reaction approves of or supports the post
- intensity 20-100: how strongly the stance is expressed (mild 20-50, strong 60-100; ignored for neutral)`;
}

export function scoreUserPrompt(topic: string, batch: Opinion[]): string {
  const reactionsBlock = batch.map((o) => `[${o.personaId}] ${o.text}`).join("\n");
  return `${postContentBlock(topic, false)}\n\nReactions:\n${reactionsBlock}\n\nScore every reaction.`;
}
