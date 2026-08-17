import { describe, expect, it } from "vitest";
import {
  countrySchema,
  defaultPersonaLang,
  normalizeOutputLang,
  outputLangName,
} from "../src/schemas";

// Two independent language axes: the personas' reaction language (from the pool's
// country) and the analysis output language (a user setting).

describe("defaultPersonaLang — reaction language per country", () => {
  it("maps every country to its official language", () => {
    expect(defaultPersonaLang("jp")).toBe("ja");
    expect(defaultPersonaLang("usa")).toBe("en");
    expect(defaultPersonaLang("fr")).toBe("fr");
    expect(defaultPersonaLang("kr")).toBe("ko");
    expect(defaultPersonaLang("br")).toBe("pt");
    expect(defaultPersonaLang("vn")).toBe("vi");
    // Multilingual countries use English (their datasets ship an English split).
    expect(defaultPersonaLang("in")).toBe("en");
    expect(defaultPersonaLang("be")).toBe("en");
  });

  it("covers every country in the schema (no country without a language)", () => {
    for (const c of countrySchema.options) {
      expect(defaultPersonaLang(c)).toBeTruthy();
    }
  });
});

describe("normalizeOutputLang / outputLangName — analysis output language", () => {
  it("en passes through; everything else falls back to ja", () => {
    expect(normalizeOutputLang("en")).toBe("en");
    expect(normalizeOutputLang("ja")).toBe("ja");
    expect(normalizeOutputLang(undefined)).toBe("ja");
    expect(normalizeOutputLang("xx")).toBe("ja");
  });

  it("outputLangName renders the English name used in analysis prompts", () => {
    expect(outputLangName("ja")).toBe("Japanese");
    expect(outputLangName("en")).toBe("English");
  });
});
