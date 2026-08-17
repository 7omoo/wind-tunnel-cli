import { z } from "zod";

// ──────────────────────────────────────────────────────────────────────
// Shared enums and LLM output schemas. Single source for the pipeline.
// The LLM output schemas double as observational validators today and as the
// basis for Ollama constrained-decoding (`format`) schemas; `.catch`/`.default`
// are validation-side conveniences and are stripped when a pure JSON Schema is
// derived for the model.
// ──────────────────────────────────────────────────────────────────────

// === Country / situation ===

export const countrySchema = z.enum(["jp", "usa", "in", "br", "fr", "kr", "vn", "be"]);
export type Country = z.infer<typeof countrySchema>;

// Situation (channel/context) = where the same persona is speaking. Anonymity,
// medium, and social role change the heat and register of the voice. Independent
// of country and language; only the reaction stage consumes it. The channel
// prose lives in prompts/situation.ts; metadata in data/situations.ts.
export const situationSchema = z.enum([
  "anon_board",
  "sns_viral",
  "news_comment",
  "public_comment",
  "real_sns",
  "consumer_survey",
]);
export type Situation = z.infer<typeof situationSchema>;

// === Languages (two independent axes) ===

// Language of the analysis output the user reads: verdict, cluster names,
// propositions, axis labels, suggestions. Independent of the personas' language.
export const outputLangSchema = z.enum(["ja", "en"]);
export type OutputLang = z.infer<typeof outputLangSchema>;

// Normalize a raw config/flag value to an output language. Anything but "en"
// (invalid, missing) falls back to "ja".
export function normalizeOutputLang(raw: unknown): OutputLang {
  return raw === "en" ? "en" : "ja";
}

// English language name for analysis prompts ("Output in {X}").
const OUTPUT_LANG_NAME: Record<OutputLang, string> = {
  ja: "Japanese",
  en: "English",
};
export function outputLangName(lang: OutputLang): string {
  return OUTPUT_LANG_NAME[lang];
}

// Language the personas speak in (the reaction stage). Wider than the output
// languages because it follows each pool's official language. Cultural context
// comes from the persona prose; this value only decides what language the
// reaction is written in.
export const personaLangSchema = z.enum(["ja", "en", "fr", "ko", "pt", "vi"]);
export type PersonaLang = z.infer<typeof personaLangSchema>;

// country -> default reaction language (the country's official language).
// Multilingual countries (in/be) use English because their datasets ship an
// English split. Custom pools override this via their dataset definition.
export function defaultPersonaLang(country: Country): PersonaLang {
  const map: Record<Country, PersonaLang> = {
    jp: "ja",
    usa: "en",
    in: "en",
    br: "pt",
    fr: "fr",
    kr: "ko",
    vn: "vi",
    be: "en",
  };
  return map[country] ?? "en";
}

// === Input limits ===

export const topicSchema = z.string().min(1).max(5000);

// Character cap for supplemental context (deep-research paste etc.). Larger than
// the topic cap on purpose. Note: context is appended to every persona prompt,
// so input tokens grow linearly with N — accepted trade-off.
export const CONTEXT_MAX_CHARS = 20000;

// === Risk levels ===

// Canonical risk levels. Closes the LLM's free-form string into a 4-value enum.
export const riskLevelSchema = z.enum(["Low", "Medium", "High", "Critical"]);
export type RiskLevel = z.infer<typeof riskLevelSchema>;

// === LLM output schemas (verdict / scores / suggestions) ===
// Deliberately lenient (loose objects, defaults on non-core fields): paired with
// parseLLMJsonChecked they observe output drift without turning it into hard
// failures. types.ts derives its types from these via z.infer so the two never drift.

export const llmTriggerSchema = z.object({
  expression: z.string(),
  offendedSegment: z.string(),
  severity: z.string(),
  count: z.number(),
  sampleOpinionIds: z.array(z.string()).default([]),
});

export const llmOpinionScoreSchema = z.object({
  personaId: z.string(),
  // -100 (most critical) .. +100 (most favorable). Out-of-range values clamp to 0.
  score: z.number().min(-100).max(100).catch(0),
  reason: z.string().default(""),
});

export const flameResultSchema = z.looseObject({
  inflammationIndex: z.number(),
  // Absorb out-of-enum values (e.g. "Severe") into Medium.
  riskLevel: riskLevelSchema.catch("Medium"),
  summary: z.string(),
  triggers: z.array(llmTriggerSchema).default([]),
  safeVersion: z.string().default(""),
  opinionScores: z.array(llmOpinionScoreSchema).optional(),
});

export const alternativeSuggestionSchema = z.object({
  id: z.string(),
  text: z.string(),
  strategy: z.string().default(""),
  targetTriggers: z.array(z.number().int()).default([]),
  estimatedRiskReduction: z.enum(["High", "Medium", "Low"]).default("Medium"),
  reasoning: z.string().default(""),
});
export const alternativeSuggestionsSchema = z.looseObject({
  alternatives: z.array(alternativeSuggestionSchema).default([]),
  commonGround: z.string().default(""),
});

// === LLM output schemas (opinion clustering) ===
// Match the raw LLM shape exactly; server-injected fields (clusterId etc.) are
// added downstream, not here.

export const groupProfileSchema = z.object({
  name: z.string(),
  coreBelief: z.string(),
  keyValues: z.array(z.string()).default([]),
  representativeQuote: z.string(),
});

export const minorityReportSchema = z.object({
  narrative: z.string(),
  blindSpots: z.array(z.string()).default([]),
});

export const propositionsSchema = z.array(z.object({ id: z.string(), text: z.string() }));
