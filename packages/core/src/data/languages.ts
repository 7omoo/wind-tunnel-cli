// Persona reaction-language metadata, single source.
// native  = native-script label (CLI display).
// english = English language name passed to the LLM ("Respond in {X}", prompts/persona.ts).
// The country -> default language mapping is a separate concern (schemas.ts defaultPersonaLang).
// To add a language, extend personaLangSchema (schemas.ts) and this file together.
import { type PersonaLang, personaLangSchema } from "../schemas";

export const PERSONA_LANGUAGES: Record<PersonaLang, { native: string; english: string }> = {
  ja: { native: "日本語", english: "Japanese" },
  en: { native: "English", english: "English" },
  fr: { native: "Français", english: "French" },
  ko: { native: "한국어", english: "Korean" },
  pt: { native: "Português", english: "Portuguese" },
  vi: { native: "Tiếng Việt", english: "Vietnamese" },
};

// The personaLangSchema enum order, derived so the two can never disagree.
export const PERSONA_LANG_CODES: readonly PersonaLang[] = personaLangSchema.options;
