import type { MockLanguageModelV4 } from "ai/test";
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

// Reactions are numbered in the prompt ("Reaction 1: ..."); the model answers
// one entry per reaction in that order. Returns the reaction texts it received.
function reactionsInPrompt(prompt: string): string[] {
  return [...prompt.matchAll(/^Reaction \d+: (.*)$/gm)].map((m) => m[1] as string);
}

describe("scoreOpinions", () => {
  it("scores every opinion across batches and sorts ascending", async () => {
    const opinions = Array.from({ length: 30 }, (_, i) => opinion(`p${i}`, `意見 ${i}`));
    const model = textModel((prompt) => {
      const stances = ["critical", "neutral", "favorable"] as const;
      const scores = reactionsInPrompt(prompt).map((_, i) => ({
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
      const reactions = reactionsInPrompt(prompt);
      if (reactions.includes("意見 0")) throw new Error("batch exploded");
      return JSON.stringify({
        scores: reactions.map(() => ({
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

describe("scoreOpinions — matching by position", () => {
  // Persona ids are never sent to the model: they made every batch a new
  // schema (an id enum) and cost tokens. Entries map back by position.
  it("numbers reactions in the prompt and keeps ids out of it", async () => {
    const prompts: string[] = [];
    const model = textModel((prompt) => {
      prompts.push(prompt);
      return JSON.stringify({
        scores: reactionsInPrompt(prompt).map(() => ({
          stance: "neutral",
          intensity: 0,
          reason: "",
        })),
      });
    });
    await scoreOpinions({
      topic: "t",
      opinions: [opinion("uuid-aaa", "first"), opinion("uuid-bbb", "second")],
      outputLang: "en",
      model,
      concurrency: 1,
    });
    expect(prompts[0]).toContain("Reaction 1: first\nReaction 2: second");
    expect(prompts[0]).not.toContain("uuid-");
  });

  it("assigns the i-th entry to the i-th reaction of the batch", async () => {
    const model = textModel(() =>
      JSON.stringify({
        scores: [
          { stance: "critical", intensity: 80, reason: "hates it" },
          { stance: "favorable", intensity: 60, reason: "likes it" },
        ],
      }),
    );
    const { scores } = await scoreOpinions({
      topic: "t",
      opinions: [opinion("x", "boo"), opinion("y", "yay")],
      outputLang: "en",
      model,
      concurrency: 1,
    });
    const byId = new Map(scores.map((s) => [s.personaId, s]));
    expect(byId.get("x")).toEqual({ personaId: "x", score: -80, reason: "hates it" });
    expect(byId.get("y")).toEqual({ personaId: "y", score: 60, reason: "likes it" });
  });
});

describe("scoreOpinions — sign composition", () => {
  it("composes the sign in code so a model sign error is impossible", async () => {
    const opinions = [opinion("a", "批判"), opinion("b", "退屈"), opinion("c", "称賛")];
    const model = textModel([
      JSON.stringify({
        scores: [
          { stance: "critical", intensity: 70, reason: "" },
          { stance: "neutral", intensity: 90, reason: "" },
          { stance: "favorable", intensity: 5, reason: "" },
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

  // A trigger cites a few representative reactions, not all of them. Uncapped,
  // a 4B model listed 98 persona ids for one trigger (8k completion tokens)
  // and the verdict hit its 600 s timeout.
  describe("sample opinion ids", () => {
    const opinions = Array.from({ length: 98 }, (_, i) => opinion(`p${i}`, "反対です"));
    const scores = opinions.map((o) => ({ personaId: o.personaId, score: -60, reason: "" }));
    const verdictJson = (ids: string[]) =>
      JSON.stringify({
        inflammationIndex: 70,
        riskLevel: "High",
        summary: "",
        triggers: [
          {
            expression: "減給",
            offendedSegment: "会社員",
            severity: "High",
            count: ids.length,
            sampleOpinionIds: ids,
          },
        ],
        safeVersion: "",
      });

    it("declares the cap in the schema sent to the model", async () => {
      const model = textModel([verdictJson(["p0"])]);
      await analyzeVerdict({ topic: "T", opinions, scores, outputLang: "ja", model });
      const format = (model as unknown as MockLanguageModelV4).doGenerateCalls[0]?.responseFormat;
      const schema = format?.type === "json" ? format.schema : undefined;
      expect(schema).toMatchObject({
        properties: {
          triggers: {
            items: { properties: { sampleOpinionIds: { maxItems: 5 } } },
          },
        },
      });
    });

    // Not every server honours maxItems; extra ids are trimmed, not a failure.
    it("keeps the first ids when the model returns more than the cap", async () => {
      const ids = opinions.map((o) => o.personaId);
      const model = textModel([verdictJson(ids)]);
      const verdict = await analyzeVerdict({
        topic: "T",
        opinions,
        scores,
        outputLang: "ja",
        model,
      });
      const kept = ids.slice(0, 5);
      expect(verdict.triggers[0]?.sampleOpinionIds).toEqual(kept);
      expect(verdict.triggers[0]?.count).toBe(98);
      expect(Object.keys(verdict.triggerAssignment ?? {})).toEqual(kept);
    });
  });
});
