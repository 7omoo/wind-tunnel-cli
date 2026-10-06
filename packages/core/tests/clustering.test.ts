import { describe, expect, it } from "vitest";
import { silhouette } from "../src/analysis/clustering";

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
