import { z } from "zod";

// ──────────────────────────────────────────────────────────────────────
// Shared enums and input limits — the single source for values that config,
// prompts, generation schemas, and domain types all refer to.
//
// LLM output is NOT described here: each pipeline stage owns the strict
// generation schema it passes to Output.object (constrained decoding), since
// most of them depend on the call (batch size, persona ids, cluster count).
// The domain types those outputs are mapped into live in types.ts.
// ──────────────────────────────────────────────────────────────────────

// === Country / situation ===

export const countrySchema = z.enum(["jp", "usa", "in", "br", "fr", "kr", "vn", "be"]);
export type Country = z.infer<typeof countrySchema>;

// Situation (channel/context) = where the same persona is speaking. Anonymity,
// medium, and social role change the heat and register of the voice. Independent
// of country and language; only the reaction stage consumes it. The channel
// prose lives in prompts/situation.ts; metadata in data/situations.ts.
// Listed anonymous & heated -> named & measured (also the display order).
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

// === Risk / severity levels ===

// Overall risk of a post (verdict). Shared by the verdict generation schema and
// the FlameResult type.
export const riskLevelSchema = z.enum(["Low", "Medium", "High", "Critical"]);
export type RiskLevel = z.infer<typeof riskLevelSchema>;

// Three-step rating used for trigger severity and a rewrite's estimated risk
// reduction. Shared by the verdict/suggest generation schemas and their types.
export const severitySchema = z.enum(["High", "Medium", "Low"]);
export type Severity = z.infer<typeof severitySchema>;
