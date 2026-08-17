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
});
