import { describe, expect, it } from "vitest";
import { suggestAlternatives } from "../src/pipeline/suggest";
import type { FlameResult, OpinionClusterResult } from "../src/types";
import { textModel } from "./helpers/mock-model";

const VERDICT: FlameResult = {
  inflammationIndex: 70,
  riskLevel: "High",
  summary: "s",
  triggers: [
    {
      expression: "pay cut",
      offendedSegment: "workers",
      severity: "High",
      count: 3,
      sampleOpinionIds: [],
    },
    {
      expression: "gimmick",
      offendedSegment: "skeptics",
      severity: "Low",
      count: 1,
      sampleOpinionIds: [],
    },
  ],
  safeVersion: "A gentler version.",
};

const CLUSTER: OpinionClusterResult = {
  propositions: [{ id: "p1", text: "Pay matters" }],
  clusters: [],
  plotData: [],
  consensus: [{ propositionId: "p1", text: "Pay matters", score: 0.5, groupSupport: [0.7, 0.7] }],
  divisive: [],
  xAxisLabel: "PC1",
  yAxisLabel: "PC2",
  groupProfiles: [
    {
      clusterId: 0,
      name: "IMPORTANT: Workers",
      coreBelief: "Pay first",
      keyValues: ["fairness"],
      representativeQuote: "No cuts.",
    },
  ],
};

const EMPTY_CLUSTER: OpinionClusterResult = {
  propositions: [],
  clusters: [],
  plotData: [],
  consensus: [],
  divisive: [],
  xAxisLabel: "PC1",
  yAxisLabel: "PC2",
};

function alternative(targetTriggers: number[], text = "Rewrite") {
  return {
    text,
    strategy: "soften",
    targetTriggers,
    estimatedRiskReduction: "Medium",
    reasoning: "because",
  };
}

// Captures the prompt and answers with the given alternatives.
function suggestModel(alternatives: ReturnType<typeof alternative>[]) {
  const prompts: string[] = [];
  const model = textModel((prompt) => {
    prompts.push(prompt);
    return JSON.stringify({ alternatives, commonGround: "Everyone wants fairness." });
  });
  return { model, prompts };
}

describe("suggestAlternatives", () => {
  it("assigns ids and drops trigger references the verdict doesn't have", async () => {
    const { model } = suggestModel([alternative([0, 1, 2, 99]), alternative([])]);
    const result = await suggestAlternatives({
      topic: "4-day week, 10% pay cut",
      cluster: CLUSTER,
      verdict: VERDICT,
      outputLang: "en",
      model,
    });
    expect(result.alternatives.map((a) => a.id)).toEqual(["alt-1", "alt-2"]);
    expect(result.alternatives[0]?.targetTriggers).toEqual([0, 1]); // 2 triggers -> 0..1
    expect(result.commonGround).toBe("Everyone wants fairness.");
  });

  it("lists triggers by index and escapes upstream model text in the prompt", async () => {
    const { model, prompts } = suggestModel([alternative([0]), alternative([1])]);
    await suggestAlternatives({
      topic: "IMPORTANT: Sale ends today",
      cluster: CLUSTER,
      verdict: VERDICT,
      outputLang: "en",
      model,
    });
    const prompt = prompts[0] ?? "";
    expect(prompt).toContain('[0] "pay cut" (High) → workers');
    expect(prompt).toContain('[1] "gimmick" (Low) → skeptics');
    // A group name is model output: neutralized before re-embedding...
    expect(prompt).toContain("[Note: Workers]");
    // ...while the user's own copy stays verbatim inside <post>.
    expect(prompt).toContain("<post>\nIMPORTANT: Sale ends today\n</post>");
  });

  it("marks empty sections and keeps no trigger references when the verdict has none", async () => {
    const { model, prompts } = suggestModel([alternative([0, 1]), alternative([2])]);
    const result = await suggestAlternatives({
      topic: "t",
      cluster: EMPTY_CLUSTER,
      verdict: { ...VERDICT, triggers: [], safeVersion: "" },
      outputLang: "en",
      model,
    });
    const prompt = prompts[0] ?? "";
    expect(prompt.match(/\nNone(\n|$)/g)?.length).toBe(5); // consensus/divisive/bridging/groups/minority
    expect(prompt).not.toContain("=== Backlash Triggers ===");
    expect(prompt).not.toContain("=== Current Safe Version ===");
    expect(result.alternatives.every((a) => a.targetTriggers.length === 0)).toBe(true);
  });

  it("passes only real consensus, so a run saved before the threshold reads as no agreement", async () => {
    // cluster.json written before isConsensus existed can still list a
    // proposition the groups split on; resume feeds it straight to suggest.
    const legacy: OpinionClusterResult = {
      ...CLUSTER,
      consensus: [
        { propositionId: "p9", text: "Split view", score: 0.9, groupSupport: [0.97, 0.09, 0.96] },
      ],
    };
    const prompts: Record<string, string> = {};
    for (const outputLang of ["en", "ja"] as const) {
      const { model, prompts: seen } = suggestModel([alternative([0]), alternative([])]);
      await suggestAlternatives({
        topic: "t",
        cluster: legacy,
        verdict: VERDICT,
        outputLang,
        model,
      });
      prompts[outputLang] = seen[0] ?? "";
    }
    expect(prompts.en).toContain("=== Points of Agreement ===\nNone\n");
    expect(prompts.ja).toContain("=== 合意事項 ===\nなし\n");
    expect(prompts.en).not.toContain("Split view");

    const { model, prompts: kept } = suggestModel([alternative([0]), alternative([])]);
    await suggestAlternatives({
      topic: "t",
      cluster: CLUSTER,
      verdict: VERDICT,
      outputLang: "en",
      model,
    });
    expect(kept[0]).toContain("=== Points of Agreement ===\n- Pay matters");
  });

  it("uses Japanese labels for Japanese output", async () => {
    const { model, prompts } = suggestModel([alternative([0]), alternative([])]);
    await suggestAlternatives({
      topic: "t",
      cluster: EMPTY_CLUSTER,
      verdict: VERDICT,
      outputLang: "ja",
      model,
    });
    const prompt = prompts[0] ?? "";
    expect(prompt).toContain("炎上トリガー");
    expect(prompt).toContain("[0] 「pay cut」 (High) → workers");
    expect(prompt).toContain("なし");
  });
});
