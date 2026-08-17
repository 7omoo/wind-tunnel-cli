// Persona reaction-language metadata, single source.
// native  = native-script label (CLI display).
// english = English language name passed to the LLM ("Respond in {X}", prompts/persona.ts).
// Order is fixed by PERSONA_LANG_CODES and must match the personaLangSchema enum order.
// The country -> default language mapping is a separate concern (schemas.ts defaultPersonaLang).
// To add a language, extend personaLangSchema (schemas.ts) and this file together.
import type { PersonaLang } from "../schemas";

export const PERSONA_LANGUAGES: Record<PersonaLang, { native: string; english: string }> = {
  ja: { native: "日本語", english: "Japanese" },
  en: { native: "English", english: "English" },
  fr: { native: "Français", english: "French" },
  ko: { native: "한국어", english: "Korean" },
  pt: { native: "Português", english: "Portuguese" },
  vi: { native: "Tiếng Việt", english: "Vietnamese" },
};

export const PERSONA_LANG_CODES = ["ja", "en", "fr", "ko", "pt", "vi"] as const;
