import { describe, expect, it } from "vitest";
import {
  computeBridging,
  detectConsensus,
  detectDivision,
  silhouette,
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
