import { PCA } from "ml-pca";
import { describe, expect, it } from "vitest";
import {
  buildClusters,
  computeBridging,
  detectConsensus,
  detectDivision,
  findMinorityDivergence,
  partitionVotes,
  silhouette,
  topPropositionsByAxis,
} from "../src/analysis/clustering";

describe("silhouette", () => {
  it("is 0 when there is no partition to evaluate", () => {
    expect(silhouette([[1]], [0])).toBe(0);
    expect(silhouette([[1], [2], [3]], [0, 0, 0])).toBe(0);
  });

  it("approaches 1 for tight, well-separated clusters", () => {
    const data = [[0], [0], [0], [10], [10], [10]];
    expect(silhouette(data, [0, 0, 0, 1, 1, 1])).toBeCloseTo(1);
  });

  it("is negative when points sit in the wrong cluster", () => {
    const data = [[0], [10], [0], [10]];
    expect(silhouette(data, [0, 0, 1, 1])).toBeLessThan(0);
  });

  // Rousseeuw (1987): s(i) = 0 for a point alone in its cluster. Scoring it 1
  // would let "one big camp + a stray singleton" outscore an honest k=1 collapse.
  it("scores a singleton cluster 0, not a perfect 1", () => {
    expect(silhouette([[0], [1]], [0, 1])).toBe(0);
  });

  it("does not let a singleton inflate the average", () => {
    // Four identical points (s = 1 each) plus one outlier alone in its cluster.
    const data = [[0], [0], [0], [0], [1]];
    expect(silhouette(data, [0, 0, 0, 0, 1])).toBeCloseTo(4 / 5);
  });
});

// A small hand-checkable corpus: two groups of two, three propositions.
//   group 0: [ 1,  1, -1]   group 1: [ 1, -1,  1]
//            [ 1, -1, -1]            [ 1, -1,  0]
// p1: everyone agrees. p2: half of group 0 agrees. p3: half of group 1 agrees.
const VOTES = [
  [1, 1, -1],
  [1, -1, -1],
  [1, -1, 1],
  [1, -1, 0],
];
const LABELS = [0, 0, 1, 1];
const PROPS = [
  { id: "p1", text: "A" },
  { id: "p2", text: "B" },
  { id: "p3", text: "C" },
];

describe("detectConsensus", () => {
  it("scores the product of Laplace-smoothed agree rates, highest first", () => {
    const result = detectConsensus(VOTES, LABELS, PROPS);
    // p1: (1+2)/(2+2) = 0.75 in both groups -> 0.5625
    // p2: 0.5 * (1+0)/4 = 0.125; p3: 0.25 * 0.5 = 0.125
    expect(result.map((c) => c.propositionId)).toEqual(["p1", "p2", "p3"]);
    expect(result[0]?.score).toBeCloseTo(0.5625);
    expect(result[0]?.groupSupport).toEqual([0.75, 0.75]);
    expect(result[1]?.score).toBeCloseTo(0.125);
  });

  // Array.prototype.sort() compares as strings: [10, 2].sort() is [10, 2].
  it("orders groups numerically even past single-digit labels", () => {
    const [p1] = detectConsensus([[1], [-1]], [10, 2], [{ id: "p1", text: "A" }]);
    // label 2 (disagrees): 1/3 first, then label 10 (agrees): 2/3
    expect(p1?.groupSupport[0]).toBeCloseTo(1 / 3);
    expect(p1?.groupSupport[1]).toBeCloseTo(2 / 3);
  });

  it("orders groupSupport by label, not by first appearance", () => {
    const [p1] = detectConsensus([[1], [-1], [-1]], [1, 0, 0], [{ id: "p1", text: "A" }]);
    // label 0 (two disagree): 1/4; label 1 (one agrees): 2/3
    expect(p1?.groupSupport[0]).toBeCloseTo(0.25);
    expect(p1?.groupSupport[1]).toBeCloseTo(2 / 3);
  });
});

describe("detectDivision", () => {
  it("ranks by the spread of raw per-group agree rates", () => {
    const result = detectDivision(VOTES, LABELS, PROPS);
    expect(result.map((d) => [d.propositionId, d.spread])).toEqual([
      ["p2", 0.5],
      ["p3", 0.5],
      ["p1", 0],
    ]);
    expect(result[0]?.groupSupport).toEqual([0.5, 0]);
  });
});

describe("computeBridging", () => {
  it("keeps propositions every group supports above 0.3, scored min * mean", () => {
    const result = computeBridging(VOTES, LABELS, PROPS);
    // p2 and p3 each have a group at 0% support.
    expect(result).toEqual([
      {
        propositionId: "p1",
        text: "A",
        bridgingScore: 1,
        minGroupSupport: 1,
        groupSupport: [1, 1],
      },
    ]);
  });

  it("excludes support of exactly 0.3 (strictly greater is required)", () => {
    // Group 1 has 10 members, 3 agree -> 0.3.
    const votes = [[1], ...Array.from({ length: 10 }, (_, i) => [i < 3 ? 1 : -1])];
    const labels = [0, ...Array.from({ length: 10 }, () => 1)];
    expect(computeBridging(votes, labels, [{ id: "p1", text: "A" }])).toEqual([]);
  });

  it("returns at most five, best first", () => {
    const props = Array.from({ length: 7 }, (_, j) => ({ id: `p${j + 1}`, text: String(j) }));
    // Everyone agrees with everything except p7, which group 1 half-supports.
    const votes = [
      [1, 1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1, -1],
    ];
    const result = computeBridging(votes, [0, 0, 1, 1], props);
    expect(result).toHaveLength(5);
    expect(result.every((b) => b.bridgingScore === 1)).toBe(true);
    expect(result.map((b) => b.propositionId)).not.toContain("p7");
  });
});

describe("findMinorityDivergence", () => {
  const props = [
    { id: "p1", text: "A" },
    { id: "p2", text: "B" },
  ];
  const cluster = (id: number, size: number, centroid: number[]) => ({
    id,
    size,
    centroid,
    memberIds: [],
  });

  it("is null without at least two clusters", () => {
    expect(findMinorityDivergence([cluster(0, 5, [1, 0])], props)).toBeNull();
  });

  it("picks the smallest cluster and ranks propositions by distance from the weighted mean", () => {
    // Overall centroid weighted by size: p1 = (3*1 + 1*-1)/4 = 0.5, p2 = (3*0 + 1*0.4)/4 = 0.1.
    const result = findMinorityDivergence([cluster(0, 3, [1, 0]), cluster(1, 1, [-1, 0.4])], props);
    expect(result?.cluster.id).toBe(1);
    expect(result?.divergences).toEqual([
      { propositionId: "p1", text: "A", minorityStance: -1, overallStance: 0.5 },
      { propositionId: "p2", text: "B", minorityStance: 0.4, overallStance: 0.1 },
    ]);
  });

  it("keeps only the top N divergences", () => {
    const many = Array.from({ length: 8 }, (_, j) => ({ id: `p${j}`, text: String(j) }));
    const result = findMinorityDivergence(
      [
        cluster(
          0,
          9,
          many.map(() => 1),
        ),
        cluster(
          1,
          1,
          many.map((_, j) => j / 10),
        ),
      ],
      many,
      3,
    );
    expect(result?.divergences.map((d) => d.propositionId)).toEqual(["p0", "p1", "p2"]);
  });
});

describe("partitionVotes", () => {
  it("separates two clear camps into two groups", () => {
    const votes = [
      ...Array.from({ length: 5 }, () => [1, 1, -1]),
      ...Array.from({ length: 5 }, () => [-1, -1, 1]),
    ];
    const { k, labels } = partitionVotes(votes);
    expect(k).toBe(2);
    expect(new Set(labels.slice(0, 5)).size).toBe(1);
    expect(labels[0]).not.toBe(labels[5]);
  });

  // Honesty rule: below SILHOUETTE_MIN a k >= 2 split is fabricated structure.
  it("collapses a unanimous corpus to a single group", () => {
    const { k, labels } = partitionVotes(Array.from({ length: 8 }, () => [1, 0, -1]));
    expect(k).toBe(1);
    expect(labels).toEqual(Array.from({ length: 8 }, () => 0));
  });

  it("uses a single group when there are too few rows to split", () => {
    expect(partitionVotes([[1], [-1], [1]])).toEqual({ k: 1, labels: [0, 0, 0] });
  });
});

describe("buildClusters", () => {
  it("averages member votes into centroids and drops empty labels", () => {
    // Label 1 is unused (k-means can leave a centroid without members).
    const clusters = buildClusters(
      [0, 0, 2],
      3,
      [
        [1, -1],
        [0, -1],
        [-1, 1],
      ],
      ["a", "b", "c"],
    );
    expect(clusters).toEqual([
      { id: 0, size: 2, centroid: [0.5, -1], memberIds: ["a", "b"] },
      { id: 2, size: 1, centroid: [-1, 1], memberIds: ["c"] },
    ]);
  });
});

describe("topPropositionsByAxis", () => {
  const props = [{ text: "A" }, { text: "B" }, { text: "C" }];

  it("reads loadings as components × propositions", () => {
    // 2 axes × 3 propositions, deliberately non-square so a transposed read
    // picks from the wrong cells.
    const loadings = [
      [0.1, -0.2, 0.9], // PC1: C dominates
      [-0.8, 0.5, 0.0], // PC2: A, then B
    ];
    const top = topPropositionsByAxis(props, loadings, 2, 2);
    expect(top.map((axis) => axis.map((p) => p.text))).toEqual([
      ["C", "B"],
      ["A", "B"],
    ]);
    expect(top[1]?.[0]?.loading).toBe(-0.8);
  });

  it("matches the orientation ml-pca's getLoadings() actually returns", () => {
    // Only proposition C varies; A and B carry a little noise. PC1 is then
    // (almost) C alone. The varying proposition is deliberately not the first:
    // with variance on A, loadings[0][0] is the same cell either way round,
    // so a transposed read would pass unnoticed.
    const votes = [
      [0, 0, 1],
      [0.1, 0, -1],
      [0, 0, 1],
      [0, 0.1, -1],
      [0, 0, 1],
      [0.1, 0, -1],
    ];
    const loadings = new PCA(votes).getLoadings().to2DArray();
    const [pc1Top] = topPropositionsByAxis(props, loadings, 1)[0] ?? [];
    expect(pc1Top?.text).toBe("C");
    expect(Math.abs(pc1Top?.loading ?? 0)).toBeCloseTo(1, 2);
  });
});
