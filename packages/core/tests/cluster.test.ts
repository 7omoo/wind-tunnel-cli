import type { LanguageModel } from "ai";
import { describe, expect, it } from "vitest";
import { clusterOpinions } from "../src/pipeline/cluster";
import { classifyStances, labelAxes } from "../src/pipeline/cluster-stages";
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

// Mock router: answers every cluster-stage call by prompt shape.
function clusterResponse(prompt: string): string {
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
}

function clusterModel() {
  return textModel(clusterResponse);
}

function models(model: LanguageModel) {
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

  it("is reproducible: identical input yields identical clusters", async () => {
    // Overlapping vote patterns, so k-means++ seeding actually matters.
    const patterns = [
      [1, 1, 0, -1],
      [1, 0, 0, -1],
      [1, 1, 1, 0],
      [0, 1, 1, 0],
      [0, 0, 1, 1],
      [-1, 0, 1, 1],
      [-1, -1, 0, 1],
      [-1, -1, -1, 0],
      [0, -1, -1, -1],
      [1, 0, -1, -1],
      [0, 0, 0, 0],
      [1, -1, 1, -1],
    ];
    const fuzzy = patterns.map((_, i) => opinion(`f${i}`, `パターン${i}`));
    const fuzzyModel = textModel((prompt) => {
      if (prompt.includes("Extract 10-15 specific propositions")) {
        return JSON.stringify({ propositions: [1, 2, 3, 4].map((n) => ({ text: `命題${n}` })) });
      }
      if (prompt.includes("Return votes as one row per opinion")) {
        const rows = [...prompt.matchAll(/^Opinion \d+: "パターン(\d+)"$/gm)].map(
          (m) => patterns[Number(m[1])] ?? [0, 0, 0, 0],
        );
        return JSON.stringify({ votes: rows });
      }
      return clusterResponse(prompt);
    });
    const run = async () => {
      const { result } = await clusterOpinions({
        topic: "テーマ",
        opinions: fuzzy,
        propositionSample: fuzzy,
        outputLang: "ja",
        models: models(fuzzyModel),
        concurrency: 4,
      });
      return result.clusters.map((c) => c.memberIds);
    };
    const first = await run();
    for (let i = 0; i < 15; i++) expect(await run()).toEqual(first);
  });

  it("degrades to PC axis labels and empty profiles when those calls fail", async () => {
    // Axis labels and group profiles are cosmetic: their failure must not lose
    // the clusters, the consensus/division math, or the minority divergences.
    const model = textModel((prompt) => {
      if (prompt.includes("principal component axes")) throw new Error("labels down");
      if (prompt.includes("group profiles")) throw new Error("profiles down");
      return clusterResponse(prompt);
    });
    const uneven = [...OPINIONS, opinion("pro6", "賛成です 6"), opinion("pro7", "賛成です 7")];
    const { result, warnings } = await clusterOpinions({
      topic: "テーマ",
      opinions: uneven,
      propositionSample: uneven,
      outputLang: "ja",
      models: models(model),
      concurrency: 4,
    });
    expect(result.xAxisLabel).toBe("PC1");
    expect(result.axes?.every((a, i) => a.label === `PC${i + 1}`)).toBe(true);
    expect(warnings.some((w) => w.includes("group profiles failed"))).toBe(true);
    expect(result.groupProfiles?.every((g) => g.name === "")).toBe(true);
    // The minority report keeps its numbers even without the model's narrative.
    expect(result.minorityReport?.narrative).toBe("");
    expect(result.minorityReport?.topDivergences.length).toBeGreaterThan(0);
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

  it("fails closed when every batch fails instead of returning an all-neutral matrix", async () => {
    const opinions = Array.from({ length: 20 }, (_, i) => opinion(`p${i}`, `意見 ${i}`));
    const outage = new Error("connect ECONNREFUSED");
    const model = textModel(() => {
      throw outage;
    });
    const promise = classifyStances({
      opinions,
      propositions: [{ id: "p1", text: "A" }],
      model,
      concurrency: 2,
      batchSize: 10,
    });
    await expect(promise).rejects.toThrow("all 2 stance batches failed");
    // The cause is kept so the CLI error classifier can see the network layer.
    await expect(promise).rejects.toHaveProperty("cause", outage);
  });
});

describe("labelAxes", () => {
  it("fills blank labels with the PC name, axis by axis", async () => {
    const model = textModel(() => JSON.stringify({ labels: ["", "強い ←→ 弱い"] }));
    const labels = await labelAxes({
      propositions: [
        { id: "p1", text: "A" },
        { id: "p2", text: "B" },
      ],
      loadings: [
        [0.9, 0.1],
        [0.1, 0.9],
      ],
      k: 2,
      outputLang: "ja",
      model,
    });
    expect(labels).toEqual(["PC1", "強い ←→ 弱い"]);
  });
});
