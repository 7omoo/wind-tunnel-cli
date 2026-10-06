import { describe, expect, it } from "vitest";
import { verdictPrompts } from "../src/prompts/analyze";

function prompt(outputLang: "ja" | "en"): string {
  return verdictPrompts({
    topic: "t",
    outputLang,
    stats: { total: 2, counts: { critical: 1, neutral: 0, favorable: 1 }, average: 0 },
    opinionCount: 2,
    sample: [],
    maxSampleIds: 5,
  }).prompt;
}

describe("verdictPrompts", () => {
  // The generation schema requires every trigger field, so the guidance must
  // define each of them — an undefined field gets filled with guesswork.
  it.each(["ja", "en"] as const)("defines every trigger field in %s", (lang) => {
    const text = prompt(lang);
    for (const field of ["expression", "offendedSegment", "count", "sampleOpinionIds"]) {
      expect(text).toContain(field);
    }
  });

  // Small models otherwise list every matching persona id (see analyze.test.ts).
  it.each([
    ["ja", "最大 5 件"],
    ["en", "at most 5"],
  ] as const)("caps sampleOpinionIds at 5 in %s", (lang, phrase) => {
    expect(prompt(lang)).toContain(phrase);
  });
});
