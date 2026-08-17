// Pool source over a real (temp) DuckDB file — exercises the native binding,
// the read-only open, and the sampling filters end to end without any network.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openPersonaPool } from "../src/personas/pool";
import { ensurePoolSchema } from "../src/personas/pool-schema";

let dir: string;
let poolPath: string;

async function seedPool(): Promise<void> {
  const instance = await DuckDBInstance.create(poolPath);
  const connection = await DuckDBConnection.create(instance);
  await ensurePoolSchema(connection);
  // 20 jp personas: alternating sex, ages 20..58, two regions.
  for (let i = 0; i < 20; i++) {
    await connection.run(
      `INSERT INTO persona VALUES (?, 'jp', ?, ?, ?, '会社員', '未婚', '大学卒', ?, '東京都', ?, 'p')`,
      [
        `jp-${i}`,
        20 + i * 2,
        i % 2 === 0 ? "男" : "女",
        i % 2 === 0 ? "M" : "F",
        i < 12 ? "関東地方" : "近畿地方",
        `テスト${i}は、東京都在住の会社員。`,
      ],
    );
  }
  await connection.run(
    "INSERT INTO pool_meta VALUES ('jp', '20-cap10-2026-08-17', 20, '2026-08-17T00:00:00Z')",
  );
  connection.closeSync();
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "wt-pool-"));
  poolPath = join(dir, "personas.duckdb");
  await seedPool();
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("openPersonaPool", () => {
  it("samples with all filters applied", async () => {
    const pool = await openPersonaPool(poolPath);
    try {
      const all = await pool.sample({ country: "jp", count: 50 });
      expect(all).toHaveLength(20);
      expect(all[0]?.professional_persona).toContain("東京都在住");

      const women = await pool.sample({ country: "jp", sex: "F", count: 50 });
      expect(women).toHaveLength(10);
      expect(women.every((p) => p.sex === "女")).toBe(true);

      const kanto = await pool.sample({ country: "jp", region: "関東地方", count: 50 });
      expect(kanto).toHaveLength(12);

      const aged = await pool.sample({ country: "jp", ageMin: 30, ageMax: 40, count: 50 });
      expect(aged.every((p) => p.age >= 30 && p.age <= 40)).toBe(true);
      expect(aged.length).toBeGreaterThan(0);

      const capped = await pool.sample({ country: "jp", count: 5 });
      expect(capped).toHaveLength(5);

      // Bypass values behave like no filter.
      const bypass = await pool.sample({
        country: "jp",
        sex: "All",
        region: "Nationwide",
        count: 50,
      });
      expect(bypass).toHaveLength(20);
    } finally {
      pool.close();
    }
  });

  it("randomizes sample order between draws", async () => {
    const pool = await openPersonaPool(poolPath);
    try {
      const draws = await Promise.all(
        Array.from({ length: 6 }, () => pool.sample({ country: "jp", count: 20 })),
      );
      const orders = new Set(draws.map((d) => d.map((p) => p.uuid).join(",")));
      expect(orders.size).toBeGreaterThan(1);
    } finally {
      pool.close();
    }
  });

  it("reports pool versions and listings", async () => {
    const pool = await openPersonaPool(poolPath);
    try {
      expect(await pool.poolVersion("jp")).toBe("20-cap10-2026-08-17");
      expect(await pool.poolVersion("fr")).toBe("none-fr");
      const infos = await pool.list();
      expect(infos).toEqual([
        {
          country: "jp",
          version: "20-cap10-2026-08-17",
          rowCount: 20,
          ingestedAt: "2026-08-17T00:00:00Z",
        },
      ]);
    } finally {
      pool.close();
    }
  });

  it("returns an empty sample for a country that is not ingested", async () => {
    const pool = await openPersonaPool(poolPath);
    try {
      expect(await pool.sample({ country: "fr", count: 10 })).toEqual([]);
    } finally {
      pool.close();
    }
  });
});
