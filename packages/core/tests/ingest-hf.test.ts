// Live Hugging Face ingest test — network-heavy, so it only runs when
// explicitly requested:
//
//   WT_TEST_HF=1 pnpm exec vitest run packages/core/tests/ingest-hf.test.ts
//
// Uses Vietnam (the smallest dataset, one parquet file) with a small cap.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pullCountryPool } from "../src/personas/ingest";
import { openPersonaPool } from "../src/personas/pool";

const enabled = process.env.WT_TEST_HF === "1";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "wt-hf-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe.skipIf(!enabled)("pullCountryPool (live Hugging Face)", () => {
  it("ingests a stratified Vietnam pool and samples from it", async () => {
    const poolPath = join(dir, "personas.duckdb");
    const result = await pullCountryPool({ country: "vn", poolPath, cap: 50 });

    expect(result.rows).toBeGreaterThan(0);
    expect(Object.keys(result.regions).length).toBeGreaterThanOrEqual(3);
    for (const n of Object.values(result.regions)) {
      expect(n).toBeLessThanOrEqual(50);
    }
    expect(result.version).toMatch(/^\d+-cap50-\d{4}-\d{2}-\d{2}$/);

    const pool = await openPersonaPool(poolPath);
    try {
      expect(await pool.poolVersion("vn")).toBe(result.version);
      const sample = await pool.sample({ country: "vn", count: 10 });
      expect(sample).toHaveLength(10);
      for (const p of sample) {
        expect(p.uuid.length).toBeGreaterThan(0);
        expect(p.professional_persona.length).toBeGreaterThan(0);
        expect(typeof p.age).toBe("number");
      }
    } finally {
      pool.close();
    }
  }, 600_000);
});
