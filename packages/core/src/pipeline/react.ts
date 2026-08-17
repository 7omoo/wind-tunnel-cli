// React stage: every persona reacts to the message once. Async generator —
// the caller consumes opinions as they arrive (progress display + JSONL
// checkpoint append), which is what makes a 15-minute local run interruptible
// for free.
//
// Concurrency is wave-based: `concurrency` requests in flight per wave, which
// mirrors how the Ollama daemon serves slots. Per-persona failures are counted,
// not thrown; zero successes IS thrown (fail-closed — an empty reaction set
// would make every downstream stage fabricate a verdict from nothing).

import { generateText, type LanguageModel } from "ai";
import { extractName } from "../personas/names";
import {
  buildContextBlock,
  buildPersonaSystemPrompt,
  getPrompt,
  getSystemExtra,
} from "../prompts/persona";
import { getSituationFraming } from "../prompts/situation";
import { CONTEXT_MAX_CHARS } from "../schemas";
import type { Country, Opinion, PersonaLang, RawPersona, Situation } from "../types";
import { sanitizePromptInput } from "../util/sanitize";
import { shuffle } from "../util/shuffle";
import { chunk } from "./batch";

export type ReactOptions = {
  topic: string;
  personas: RawPersona[];
  country: Country;
  situation: Situation;
  personaLang: PersonaLang;
  // Optional shared background text (user-provided). Sanitized here with the
  // larger context cap; appended to every persona's prompt.
  context?: string;
  model: LanguageModel;
  concurrency: number;
};

export type ReactSummary = { requested: number; succeeded: number; failed: number };

export async function* reactPersonas(opts: ReactOptions): AsyncGenerator<Opinion, ReactSummary> {
  const topic = sanitizePromptInput(opts.topic);
  const context = opts.context ? sanitizePromptInput(opts.context, CONTEXT_MAX_CHARS) : "";
  const lang = opts.personaLang;

  // One pool language per run (v1), so the language-dependent parts are built once.
  const extra = getSystemExtra(lang);
  const framing = getSituationFraming(opts.situation, lang, opts.country);
  const prompt = getPrompt(topic, lang, opts.situation) + buildContextBlock(context, lang);

  const targets = shuffle(opts.personas);
  let succeeded = 0;
  let failed = 0;
  let lastError: unknown;

  for (const wave of chunk(targets, Math.max(1, opts.concurrency))) {
    const results = await Promise.allSettled(
      wave.map(async (p): Promise<Opinion> => {
        const name = extractName(p.professional_persona, opts.country);
        const system =
          buildPersonaSystemPrompt(
            name,
            {
              age: p.age,
              sex: p.sex,
              occupation: p.occupation,
              professional_persona: p.professional_persona,
            },
            lang,
          ) +
          extra +
          framing;
        const { text } = await generateText({ model: opts.model, system, prompt });
        return {
          personaId: p.uuid,
          name,
          text,
          attributes: {
            age: p.age,
            sex: p.sex,
            occupation: p.occupation,
            location: p.locality || p.region || "",
            marital_status: p.marital_status,
          },
        };
      }),
    );
    for (const result of results) {
      if (result.status === "fulfilled") {
        succeeded++;
        yield result.value;
      } else {
        failed++;
        lastError = result.reason;
      }
    }
  }

  if (succeeded === 0 && targets.length > 0) {
    const detail = lastError instanceof Error ? `: ${lastError.message}` : "";
    throw new Error(`all ${targets.length} persona reactions failed${detail}`);
  }
  return { requested: targets.length, succeeded, failed };
}
