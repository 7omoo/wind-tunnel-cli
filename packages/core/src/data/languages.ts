// Persona reaction-language names, single source: the English name the LLM is
// told to respond in ("Respond in {X}", prompts/persona.ts). The country ->
// default language mapping is a separate concern (schemas.ts
// defaultPersonaLang). To add a language, extend personaLangSchema
// (schemas.ts) and this table together.
import type { PersonaLang } from "../schemas";

export const PERSONA_LANGUAGE_NAMES: Record<PersonaLang, string> = {
  ja: "Japanese",
  en: "English",
  fr: "French",
  ko: "Korean",
  pt: "Portuguese",
  vi: "Vietnamese",
};
