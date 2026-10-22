// Offline tests for ingest decisions. The live download is covered by
// ingest-hf.test.ts (opt-in, network-heavy).

import { describe, expect, it } from "vitest";
import { expectedRegionsFull, pullCountryPool } from "../src/personas/ingest";
import { CuratedError } from "../src/util/curated-error";

describe("pullCountryPool", () => {
  // Rejected before the pool file or the network is touched.
  it.each([0, 100_001])("refuses cap %s with the valid range", async (cap) => {
    const e = await pullCountryPool({ country: "jp", poolPath: "/nonexistent/pool.duckdb", cap })
      .then(() => null)
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(CuratedError);
    expect((e as Error).message).toBe(`invalid cap ${cap} — must be an integer from 1 to 100000`);
  });
});

describe("expectedRegionsFull (early-stop rule)", () => {
  const expected = ["A", "B"];

  it("is true once every expected region reaches the cap", () => {
    const counts = new Map([
      ["A", 100],
      ["B", 100],
    ]);
    expect(expectedRegionsFull(counts, expected, 100)).toBe(true);
  });

  it("is false while an expected region is below the cap", () => {
    const counts = new Map([
      ["A", 100],
      ["B", 40],
    ]);
    expect(expectedRegionsFull(counts, expected, 100)).toBe(false);
  });

  it("is false while an expected region has not appeared yet", () => {
    expect(expectedRegionsFull(new Map([["A", 100]]), expected, 100)).toBe(false);
  });

  // USA lists PR as an extra region; it is small and may never reach the cap,
  // which used to keep every parquet file downloading.
  it("ignores extra regions that stay below the cap", () => {
    const counts = new Map([
      ["A", 100],
      ["B", 100],
      ["PR", 7],
    ]);
    expect(expectedRegionsFull(counts, expected, 100)).toBe(true);
  });

  it("never stops early for relaxed-mode presets with no expected regions", () => {
    expect(expectedRegionsFull(new Map([["X", 500]]), [], 100)).toBe(false);
  });
});
