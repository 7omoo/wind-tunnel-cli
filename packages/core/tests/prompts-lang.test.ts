import { describe, expect, it } from "vitest";
import { buildPersonaSystemPrompt, getPrompt, getSystemExtra } from "../src/prompts/persona";

// The persona voice's language follows personaLang: ja gets dedicated Japanese
// prompts, every other language shares the English scaffold plus
// "Respond in {language name}".
const persona = {
  age: 40,
  sex: "Male",
  occupation: "teacher",
  professional_persona: "A dedicated teacher.",
};

describe("persona-voice language (personaLang)", () => {
  it("ja gets the Japanese prompt", () => {
    expect(getPrompt("topic", "ja")).toContain("日本語");
    expect(buildPersonaSystemPrompt("太郎", persona, "ja")).toContain("あなたは");
  });

  it("en gets 'Respond in English'", () => {
    expect(getPrompt("topic", "en")).toContain("Respond in English");
    expect(buildPersonaSystemPrompt("John", persona, "en")).toContain("Respond in English");
  });

  it("fr gets 'Respond in French' (new languages become native instructions)", () => {
    expect(getPrompt("topic", "fr")).toContain("Respond in French");
    expect(buildPersonaSystemPrompt("Marie", persona, "fr")).toContain("Respond in French");
  });

  it("ko / pt / vi each get their Respond-in instruction", () => {
    expect(getPrompt("t", "ko")).toContain("Respond in Korean");
    expect(getPrompt("t", "pt")).toContain("Respond in Portuguese");
    expect(getPrompt("t", "vi")).toContain("Respond in Vietnamese");
  });

  it("getSystemExtra is behavior, not language instruction (ja=Japanese prose / others=English scaffold)", () => {
    expect(getSystemExtra("ja")).toContain("正直に");
    expect(getSystemExtra("fr")).toContain("React honestly");
  });
});
