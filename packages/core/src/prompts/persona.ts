// Persona-voice prompts. Language branching follows personaLang (the language
// the persona speaks in), independent of country (pool choice) and of the
// analysis output language. ja has dedicated Japanese prompts; every other
// language shares the English scaffold plus "Respond in {language name}".
// Cultural context comes from the persona prose; this layer only decides what
// language the reaction is written in. Analysis prompts (verdict, cluster names,
// suggestions) live with their pipeline stages and use the output language instead.

import { PERSONA_LANG_CODES, PERSONA_LANGUAGES } from "../data/languages";
import type { PersonaLang, Situation } from "../types";
import { DEFAULT_SITUATION, lengthClause } from "./situation";

// personaLang -> English language name for the "Respond in {X}" instruction.
const LANGUAGE_NAMES = Object.fromEntries(
  PERSONA_LANG_CODES.map((c) => [c, PERSONA_LANGUAGES[c].english]),
) as Record<PersonaLang, string>;

export function getSystemExtra(personaLang: PersonaLang): string {
  // Forcing every persona to "be critical" makes all of them nitpick even a
  // harmless message and the backlash index saturates (observed failure mode).
  // Instead, approval, criticism and indifference are all allowed symmetrically
  // to draw out the person's real reaction. (The response language is instructed
  // by getPrompt / buildPersonaSystemPrompt; this block is behavior only.)
  if (personaLang !== "ja") {
    return "\n\nReact honestly, true to your own personality and values. If you genuinely like it, say so; if something bothers you, name it specifically; if it just doesn't land for you, say that plainly. Don't manufacture criticism — give your real, individual reaction.";
  }
  return "\n\nあなた自身の性格と価値観に正直に反応してください。心から良いと感じたら率直に評価し、引っかかる点があれば具体的に指摘し、特に何も響かなければそのまま述べてください。無理に粗探しをする必要はありません — あなたという一人の人間の、本当の反応を返してください。";
}

export function getPrompt(
  topic: string,
  personaLang: PersonaLang,
  situation: Situation = DEFAULT_SITUATION,
): string {
  const len = lengthClause(situation, personaLang === "ja");
  if (personaLang !== "ja") {
    const lang = LANGUAGE_NAMES[personaLang];
    return `Read the following post/ad copy and give your own honest reaction. Maybe you like it, maybe something bothers you, maybe it just doesn't move you — say what you actually feel, true to your values. Respond in ${lang} ${len}.\n\nPost content: ${topic}`;
  }
  return `以下の投稿・広告文を読み、あなた自身の率直な反応を述べてください。良いと感じた点、気になった点、あるいは特に何も感じないなら、そのまま — あなたの価値観に正直に、日本語で${len}回答してください。\n\n投稿内容: ${topic}`;
}

// Supplemental context shared by all personas (user-provided background text).
// Wrapped per language and appended to the user prompt. The honesty of the
// reaction is handled by getSystemExtra / situation framing; this only hands
// over background.
export function buildContextBlock(context: string, personaLang: PersonaLang): string {
  const c = context.trim();
  if (!c) return "";
  if (personaLang === "ja") {
    return `\n\n【参考情報】\n${c}\n\nこの参考情報も踏まえて、あなた自身の率直な反応を述べてください。`;
  }
  return `\n\nReference information:\n${c}\n\nTake this reference information into account in your own honest reaction.`;
}

export function buildPersonaSystemPrompt(
  name: string,
  persona: {
    age: number;
    sex: string;
    occupation: string;
    professional_persona: string;
  },
  personaLang: PersonaLang,
): string {
  if (personaLang !== "ja") {
    const lang = LANGUAGE_NAMES[personaLang];
    return `You are ${name}, a ${persona.age}-year-old ${persona.sex} working as ${persona.occupation}. ${persona.professional_persona}\n\nSpeak naturally as this person would. Give your honest, personal opinion based on your background and values. Respond in ${lang}.`;
  }
  return `あなたは${name}です。${persona.age}歳の${persona.sex}で、${persona.occupation}として働いています。${persona.professional_persona}\n\nこの人物として自然に話してください。あなたの背景と価値観に基づいた率直で個人的な意見を述べてください。日本語で回答してください。`;
}
