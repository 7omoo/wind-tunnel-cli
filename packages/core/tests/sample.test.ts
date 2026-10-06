import { describe, expect, it } from "vitest";
import { type ScoredOpinion, stratifiedSample } from "../src/pipeline/sample";
import type { Opinion } from "../src/types";

function scored(id: string, score: number, text = `opinion ${id}`): ScoredOpinion {
  const opinion: Opinion = {
    personaId: id,
    name: id,
    text,
    attributes: { age: 30, sex: "", occupation: "", location: "", marital_status: "" },
  };
  return { opinion, score };
}

// Deterministic RNG for reproducible neutral picks.
const rng = () => 0.42;

describe("stratifiedSample", () => {
  it("returns everything (sorted ascending) when within both budgets", () => {
    const items = [scored("a", 50), scored("b", -80), scored("c", 0)];
    const out = stratifiedSample(items, { maxCount: 10, maxChars: 10000, random: rng });
    expect(out.map((s) => s.opinion.personaId)).toEqual(["b", "c", "a"]);
  });

  it("keeps both extremes when sampling down", () => {
    const items = Array.from({ length: 100 }, (_, i) => scored(`p${i}`, i * 2 - 100)); // -100..98
    const out = stratifiedSample(items, { maxCount: 20, maxChars: 100000, random: rng });
    expect(out.length).toBe(20);
    const scores = out.map((s) => s.score);
    expect(Math.min(...scores)).toBe(-100); // most critical survives
    expect(Math.max(...scores)).toBe(98); // most favorable survives
    // Sorted ascending (most critical first) — the order the verdict prompt expects.
    expect([...scores].sort((a, b) => a - b)).toEqual(scores);
  });

  it("weights the sample toward the critical end (40/30/30)", () => {
    const items = Array.from({ length: 100 }, (_, i) => scored(`p${i}`, i * 2 - 100));
    const out = stratifiedSample(items, { maxCount: 20, maxChars: 100000, random: rng });
    const critical = out.filter((s) => s.score <= -20).length;
    const favorable = out.filter((s) => s.score >= 20).length;
    expect(critical).toBeGreaterThanOrEqual(favorable);
  });

  it("enforces the char budget by dropping from the middle, keeping >= 3", () => {
    const long = "あ".repeat(500);
    const items = Array.from({ length: 30 }, (_, i) => scored(`p${i}`, i * 7 - 100, long));
    const out = stratifiedSample(items, { maxCount: 30, maxChars: 2000, random: rng });
    const chars = out.reduce((sum, s) => sum + s.opinion.text.length, 0);
    expect(out.length).toBeGreaterThanOrEqual(3);
    expect(chars).toBeLessThanOrEqual(2500); // budget + one item of slack
    const scores = out.map((s) => s.score);
    expect(Math.min(...scores)).toBe(-100);
    expect(Math.max(...scores)).toBe(29 * 7 - 100);
  });

  // ceil(0.4·1) + ceil(0.3·1) = 2 slots for a target of 1: the same opinion was
  // taken as both "most critical" and "most favorable", or the cap was exceeded.
  it("never duplicates an opinion when a single over-long one must be sampled", () => {
    const out = stratifiedSample([scored("only", -50, "x".repeat(500))], {
      maxCount: 150,
      maxChars: 100,
      random: rng,
    });
    expect(out.map((s) => s.opinion.personaId)).toEqual(["only"]);
  });

  it("respects maxCount even at 1", () => {
    const items = Array.from({ length: 10 }, (_, i) => scored(`p${i}`, i * 10 - 50));
    const out = stratifiedSample(items, { maxCount: 1, maxChars: 100000, random: rng });
    expect(out).toHaveLength(1);
    expect(out[0]?.score).toBe(-50); // the most critical slot is filled first
  });

  it("never exceeds maxCount or repeats an opinion for any small cap", () => {
    const items = Array.from({ length: 12 }, (_, i) => scored(`p${i}`, i * 10 - 60));
    for (let maxCount = 1; maxCount <= 12; maxCount++) {
      const out = stratifiedSample(items, { maxCount, maxChars: 100000, random: rng });
      const ids = out.map((s) => s.opinion.personaId);
      expect(ids.length).toBeLessThanOrEqual(maxCount);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
