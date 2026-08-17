import { describe, expect, it } from "vitest";
import { clusterOpinions } from "../src/pipeline/cluster";
import { classifyStances } from "../src/pipeline/cluster-stages";
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

// Two clearly separated camps so k-means has real structure to find.
const OPINIONS: Opinion[] = [
  ...Array.from({ length: 6 }, (_, i) => opinion(`pro${i}`, `賛成です ${i}`)),
  ...Array.from({ length: 6 }, (_, i) => opinion(`con${i}`, `反対です ${i}`)),
];

const PROPOSITIONS = { propositions: [{ text: "命題A" }, { text: "命題B" }, { text: "命題C" }] };

// Mock router: one model answers every cluster-stage call by shape.
function clusterModel() {
  return textModel((prompt) => {
    if (prompt.includes("Extract 10-15 specific propositions")) {
      return JSON.stringify(PROPOSITIONS);
    }
    if (prompt.includes("Return votes as one row per opinion")) {
      // Vote by camp: "賛成" agrees, "反対" disagrees.
      const rows = [...prompt.matchAll(/^Opinion \d+: "(.+)"$/gm)].map((m) =>
        (m[1] ?? "").startsWith("賛成") ? [1, 1, -1] : [-1, -1, 1],
      );
      return JSON.stringify({ votes: rows });
    }
    if (prompt.includes("principal component axes")) {
      return JSON.stringify({ labels: ["賛成 ←→ 反対", "強い ←→ 弱い", "A ←→ B"] });
    }
    if (prompt.includes("group profiles")) {
      const count = Number(prompt.match(/Return exactly (\d+) group profiles/)?.[1] ?? 2);
      return JSON.stringify({
        groups: Array.from({ length: count }, (_, i) => ({
          name: `グループ${i + 1}`,
          coreBelief: "信念",
          keyValues: ["価値1", "価値2"],
          representativeQuote: "代表的発言",
        })),
        minority: { narrative: "少数派の視点", blindSpots: ["盲点1"] },
      });
    }
    throw new Error(`unexpected prompt: ${prompt.slice(0, 80)}`);
  });
}

function models(model: ReturnType<typeof clusterModel>) {
  return { propositions: model, stances: model, axisLabels: model, profiles: model };
}

describe("clusterOpinions", () => {
  it("produces clusters, consensus/division, axes and profiles", async () => {
    const model = clusterModel();
    const { result, warnings } = await clusterOpinions({
      topic: "テーマ",
      opinions: OPINIONS,
      propositionSample: OPINIONS,
      outputLang: "ja",
      models: models(model),
      concurrency: 2,
    });
    expect(warnings).toEqual([]);
    expect(result.propositions).toHaveLength(3);
    expect(result.propositions[0]?.id).toBe("p1"); // ids assigned locally
    expect(result.clusters.length).toBeGreaterThanOrEqual(2);
    // Every opinion lands in exactly one cluster.
    const assigned = result.clusters.flatMap((c) => c.memberIds);
    expect(assigned).toHaveLength(OPINIONS.length);
    expect(new Set(assigned).size).toBe(OPINIONS.length);
    expect(result.plotData).toHaveLength(OPINIONS.length);
    expect(result.divisive.length).toBeGreaterThan(0);
    expect(result.xAxisLabel).toBe("賛成 ←→ 反対");
    expect(result.axes?.[0]?.variancePct).toBeGreaterThan(0);
    expect(result.groupProfiles?.length).toBe(result.clusters.length);
    expect(result.minorityReport?.narrative).toBe("少数派の視点");
  });

  it("separates the two camps into different clusters", async () => {
    const { result } = await clusterOpinions({
      topic: "テーマ",
      opinions: OPINIONS,
      propositionSample: OPINIONS,
      outputLang: "ja",
      models: models(clusterModel()),
      concurrency: 4,
    });
    const clusterOf = new Map<string, number>();
    for (const c of result.clusters) for (const id of c.memberIds) clusterOf.set(id, c.id);
    expect(clusterOf.get("pro0")).toBe(clusterOf.get("pro5"));
    expect(clusterOf.get("con0")).toBe(clusterOf.get("con5"));
    expect(clusterOf.get("pro0")).not.toBe(clusterOf.get("con0"));
  });

  it("collapses to a single group when the corpus is unanimous (honesty rule)", async () => {
    // Every opinion votes identically -> silhouette carries no structure ->
    // the fabricated k>=2 split must collapse instead of showing twin camps.
    const unanimous = Array.from({ length: 8 }, (_, i) => opinion(`u${i}`, `賛成です ${i}`));
    const { result } = await clusterOpinions({
      topic: "テーマ",
      opinions: unanimous,
      propositionSample: unanimous,
      outputLang: "ja",
      models: models(clusterModel()),
      concurrency: 4,
    });
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0]?.size).toBe(8);
    expect(result.groupProfiles).toHaveLength(1);
    expect(result.minorityReport).toBeNull();
    expect(result.divisive).toEqual([]);
    expect(result.bridging).toBeUndefined();
  });

  it("rejects corpora too small to cluster", async () => {
    await expect(
      clusterOpinions({
        topic: "t",
        opinions: [opinion("a", "x"), opinion("b", "y")],
        propositionSample: [],
        outputLang: "ja",
        models: models(clusterModel()),
        concurrency: 1,
      }),
    ).rejects.toThrow(/not enough opinions/);
  });
});

describe("classifyStances", () => {
  it("degrades a failed batch to neutral rows and warns, keeping the matrix rectangular", async () => {
    const opinions = Array.from({ length: 20 }, (_, i) => opinion(`p${i}`, `意見 ${i}`));
    const propositions = [
      { id: "p1", text: "A" },
      { id: "p2", text: "B" },
    ];
    const model = textModel((prompt) => {
      if (prompt.includes('Opinion 1: "意見 0"')) throw new Error("batch failed");
      const rows = [...prompt.matchAll(/^Opinion \d+: ".+"$/gm)].map(() => [1, -1]);
      return JSON.stringify({ votes: rows });
    });
    const { voteMatrix, warnings } = await classifyStances({
      opinions,
      propositions,
      model,
      concurrency: 2,
      batchSize: 10,
    });
    expect(voteMatrix).toHaveLength(20);
    expect(voteMatrix.every((row) => row.length === 2)).toBe(true);
    expect(voteMatrix.slice(0, 10).every((row) => row.every((v) => v === 0))).toBe(true);
    expect(warnings.some((w) => w.includes("rows neutral"))).toBe(true);
  });
});
