import { describe, expect, it } from "vitest";
import { chunk, mapWaves } from "../src/pipeline/batch";

describe("chunk", () => {
  it("splits into fixed-size groups with a remainder", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });

  it("guards degenerate sizes", () => {
    expect(chunk([1, 2], 0)).toEqual([[1], [2]]);
  });
});

describe("mapWaves", () => {
  it("bounds concurrency to the wave size", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    await mapWaves([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return n;
    });
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it("preserves input order and captures failures without throwing", async () => {
    const settled = await mapWaves([1, 2, 3, 4], 2, async (n) => {
      if (n === 3) throw new Error("boom");
      return n * 10;
    });
    expect(settled.map((s) => s.status)).toEqual([
      "fulfilled",
      "fulfilled",
      "rejected",
      "fulfilled",
    ]);
    expect(settled[3]?.status === "fulfilled" && settled[3].value).toBe(40);
  });

  it("reports progress per wave", async () => {
    const progress: [number, number][] = [];
    await mapWaves(
      [1, 2, 3, 4, 5],
      2,
      async (n) => n,
      (done, total) => progress.push([done, total]),
    );
    expect(progress).toEqual([
      [2, 5],
      [4, 5],
      [5, 5],
    ]);
  });
});
