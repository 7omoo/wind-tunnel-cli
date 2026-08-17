import { describe, expect, it } from "vitest";
import { analyzeVerdict, scoreOpinions } from "../src/pipeline/analyze";
import type { Opinion } from "../src/types";
import { textModel } from "./helpers/mock-model";

function opinion(id: string, text: string): Opinion {
  return {
    personaId: id,
    name: id,
    text,
    attributes: { age: 30, sex: "", occupation: "", location: "", marital_status: "" },
  };
}

// Parse "[id] text" lines out of the prompt the mock actually received.
function idsInPrompt(prompt: string): string[] {
  return [...prompt.matchAll(/^\[([^\]]+)\]/gm)].map((m) => m[1] as string);
}

describe("scoreOpinions", () => {
  it("scores every opinion across batches and sorts ascending", async () => {
    const opinions = Array.from({ length: 30 }, (_, i) => opinion(`p${i}`, `意見 ${i}`));
    const model = textModel((prompt) => {
      const ids = idsInPrompt(prompt);
      const stances = ["critical", "neutral", "favorable"] as const;
      const scores = ids.map((personaId, i) => ({
        personaId,
        stance: stances[i % 3],
        intensity: 20 + ((i * 13) % 80),
        reason: "理由",
      }));
      return JSON.stringify({ scores });
    });
    const { scores, warnings } = await scoreOpinions({
      topic: "テスト",
      opinions,
      outputLang: "ja",
      model,
      concurrency: 2,
      batchSize: 25,
    });
    expect(scores).toHaveLength(30);
    expect(model.calls()).toBe(2); // 25 + 5
    expect(warnings).toEqual([]);
    const values = scores.map((s) => s.score);
    expect([...values].sort((a, b) => a - b)).toEqual(values);
    expect(new Set(scores.map((s) => s.personaId)).size).toBe(30);
  });

  it("defaults opinions from failed batches to 0 and reports it", async () => {
    const opinions = Array.from({ length: 20 }, (_, i) => opinion(`p${i}`, `意見 ${i}`));
    // Fail the batch that contains p0 (first batch); succeed the second.
    const model = textModel((prompt) => {
      const ids = idsInPrompt(prompt);
      if (ids.includes("p0")) throw new Error("batch exploded");
      return JSON.stringify({
        scores: ids.map((personaId) => ({
          personaId,
          stance: "favorable",
          intensity: 40,
          reason: "",
        })),
      });
    });
    const { scores, warnings } = await scoreOpinions({
      topic: "テスト",
      opinions,
      outputLang: "ja",
      model,
      concurrency: 2,
      batchSize: 10,
    });
    expect(scores).toHaveLength(20);
    expect(scores.filter((s) => s.score === 0)).toHaveLength(10);
    expect(warnings.some((w) => w.includes("failed"))).toBe(true);
    expect(warnings.some((w) => w.includes("defaulted"))).toBe(true);
  });

  it("throws when every batch fails", async () => {
    const opinions = Array.from({ length: 5 }, (_, i) => opinion(`p${i}`, "x"));
    const model = textModel(() => {
      throw new Error("all down");
    });
    await expect(
      scoreOpinions({ topic: "t", opinions, outputLang: "ja", model, concurrency: 2 }),
    ).rejects.toThrow(/all .* score batches failed/);
  });
});

describe("scoreOpinions — sign composition", () => {
  it("composes the sign in code so a model sign error is impossible", async () => {
    const opinions = [opinion("a", "批判"), opinion("b", "退屈"), opinion("c", "称賛")];
    const model = textModel([
      JSON.stringify({
        scores: [
          { personaId: "a", stance: "critical", intensity: 70, reason: "" },
          { personaId: "b", stance: "neutral", intensity: 90, reason: "" },
          { personaId: "c", stance: "favorable", intensity: 5, reason: "" },
        ],
      }),
    ]);
    const { scores } = await scoreOpinions({
      topic: "t",
      opinions,
      outputLang: "ja",
      model,
      concurrency: 1,
    });
    const byId = new Map(scores.map((s) => [s.personaId, s.score]));
    expect(byId.get("a")).toBe(-70); // critical -> negative, always
    expect(byId.get("b")).toBe(0); // neutral -> 0 regardless of intensity
    expect(byId.get("c")).toBe(20); // favorable clamps into its band (>= +20)
  });
});

describe("analyzeVerdict", () => {
  it("assembles the verdict with scores and trigger assignment", async () => {
    const opinions = [
      opinion("a", "ひどい表現だ"),
      opinion("b", "普通です"),
      opinion("c", "素晴らしい"),
    ];
    const scores = [
      { personaId: "a", score: -80, reason: "怒り" },
      { personaId: "b", score: 0, reason: "中立" },
      { personaId: "c", score: 70, reason: "称賛" },
    ];
    const model = textModel([
      JSON.stringify({
        inflammationIndex: 55,
        riskLevel: "Medium",
        summary: "一部の層が反発しています。",
        triggers: [
          {
            expression: "問題の言い回し",
            offendedSegment: "医療従事者",
            severity: "High",
            count: 1,
            sampleOpinionIds: ["a"],
          },
        ],
        safeVersion: "より穏当な表現です。",
      }),
    ]);
    const verdict = await analyzeVerdict({
      topic: "テスト投稿",
      opinions,
      scores,
      outputLang: "ja",
      model,
    });
    expect(verdict.inflammationIndex).toBe(55);
    expect(verdict.riskLevel).toBe("Medium");
    expect(verdict.triggers).toHaveLength(1);
    expect(verdict.triggerAssignment).toEqual({ a: 0 });
    expect(verdict.opinionScores).toBe(scores);
  });

  it("includes aggregate stats and the sample in the prompt", async () => {
    const opinions = [opinion("a", "反対です"), opinion("b", "賛成です")];
    const scores = [
      { personaId: "a", score: -50, reason: "" },
      { personaId: "b", score: 50, reason: "" },
    ];
    let seen = "";
    const model = textModel((prompt) => {
      seen = prompt;
      return JSON.stringify({
        inflammationIndex: 10,
        riskLevel: "Low",
        summary: "",
        triggers: [],
        safeVersion: "",
      });
    });
    await analyzeVerdict({ topic: "T", opinions, scores, outputLang: "ja", model });
    expect(seen).toContain("批判的 1 件 (50%)"); // aggregate stats block
    expect(seen).toContain("[a] (score -50) 反対です"); // sampled reaction line
  });
});
