// `personas pull` — stream a country preset from Hugging Face into the local
// pool. The transfer strategy comes from a measured property of the datasets:
// rows are randomly distributed across the parquet files (per-file region
// shares match the whole-dataset shares), so a region-stratified sample can be
// drawn file by file and stop as soon as every region hits the cap — Japan
// fills from 1 of its 8 files instead of a 1.73 GB download. Column projection
// via hf:// keeps the skipped prose variants (sports/arts/travel/... personas)
// from ever being transferred.
//
// Files are processed one at a time into a staging table; each file's INSERT
// takes only each region's remaining deficit. The pool swap (DELETE + INSERT +
// meta upsert) is transactional, so a failed pull never corrupts an existing
// pool for that country.

import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import type { Country } from "../types";
import { ensurePoolSchema } from "./pool-schema";
import { COUNTRY_PRESETS, presetGlob, SEX_NORM_SQL } from "./presets";

export type IngestProgress =
  | { type: "listing" }
  | { type: "file"; index: number; total: number; rows: number; regions: number }
  | { type: "swapping" };

export type IngestResult = {
  country: Country;
  rows: number;
  regions: Record<string, number>;
  filesRead: number;
  filesTotal: number;
  version: string;
};

export async function pullCountryPool(opts: {
  country: Country;
  poolPath: string;
  cap?: number;
  onProgress?: (p: IngestProgress) => void;
}): Promise<IngestResult> {
  const preset = COUNTRY_PRESETS[opts.country];
  const cap = opts.cap ?? preset.defaultCap;
  if (!Number.isInteger(cap) || cap < 1 || cap > 100000) {
    throw new Error(`invalid cap: ${opts.cap}`);
  }
  const emit = opts.onProgress ?? (() => {});

  // First pull on a fresh machine: the data directory doesn't exist yet and
  // DuckDB won't create parents.
  await mkdir(dirname(opts.poolPath), { recursive: true });
  const instance = await DuckDBInstance.create(opts.poolPath);
  const connection = await DuckDBConnection.create(instance);
  try {
    await ensurePoolSchema(connection);

    emit({ type: "listing" });
    const filesResult = await connection.run(
      `SELECT file FROM glob('${presetGlob(preset)}') ORDER BY file`,
    );
    const files = (await filesResult.getRows()).map((r) => String(r[0]));
    if (files.length === 0) {
      throw new Error(`no parquet files found for ${preset.datasetId} (${preset.split})`);
    }

    // Staging table; same shape as persona. Temp = dropped on disconnect.
    await connection.run("CREATE OR REPLACE TEMP TABLE stage AS SELECT * FROM persona LIMIT 0");

    // The mapped projection over one source file. The preset SQL fragments are
    // code-owned constants (not user input); cap and country go in as literals
    // after validation above / enum typing.
    const sourceSelect = (file: string) => `
      SELECT
        CAST(uuid AS VARCHAR) AS uuid,
        '${preset.country}' AS country,
        CAST(age AS INTEGER) AS age,
        CAST(sex AS VARCHAR) AS sex,
        ${SEX_NORM_SQL} AS sex_norm,
        CAST(occupation AS VARCHAR) AS occupation,
        CAST(marital_status AS VARCHAR) AS marital_status,
        CAST(education_level AS VARCHAR) AS education_level,
        CAST(${preset.regionSql} AS VARCHAR) AS region,
        CAST(${preset.localitySql} AS VARCHAR) AS locality,
        professional_persona,
        persona
      FROM read_parquet('${file.replaceAll("'", "''")}')`;

    let filesRead = 0;
    for (const [index, file] of files.entries()) {
      // Stop early once every observed region is full — but only when the
      // expected-region set is known and fully present (jp/usa). Relaxed-mode
      // countries read one more file and stop on a zero-row insert instead.
      const before = await countRows(connection, "stage");
      await connection.run(`
        INSERT INTO stage
        WITH src AS (${sourceSelect(file)}),
        ranked AS (
          SELECT *, row_number() OVER (PARTITION BY region ORDER BY random()) AS __rn FROM src
        ),
        have AS (SELECT region AS __region, count(*) AS __have FROM stage GROUP BY region)
        SELECT uuid, country, age, sex, sex_norm, occupation, marital_status,
               education_level, region, locality, professional_persona, persona
        FROM ranked LEFT JOIN have ON ranked.region = have.__region
        WHERE __rn <= ${cap} - COALESCE(__have, 0)`);
      filesRead = index + 1;

      const after = await countRows(connection, "stage");
      const regionRows = await connection.run(
        "SELECT region, count(*)::int FROM stage GROUP BY region",
      );
      const regions = await regionRows.getRows();
      emit({
        type: "file",
        index: filesRead,
        total: files.length,
        rows: after,
        regions: regions.length,
      });

      if (after === before) break; // nothing new — every reachable region is full
      if (preset.expectedRegions.length > 0) {
        const known = new Set(regions.map((r) => String(r[0])));
        const allExpectedSeen = preset.expectedRegions.every((r) => known.has(r));
        const minCount = regions.reduce((min, r) => Math.min(min, Number(r[1])), Infinity);
        if (allExpectedSeen && minCount >= cap) break;
      }
    }

    // ── validation before the swap ──
    const rows = await countRows(connection, "stage");
    if (rows === 0) throw new Error("ingest produced no rows");
    const nullCheck = await connection.run(
      `SELECT count(*)::int FROM stage
       WHERE uuid IS NULL OR professional_persona IS NULL OR region IS NULL OR age IS NULL`,
    );
    const nulls = Number((await nullCheck.getRows())[0]?.[0] ?? 0);
    if (nulls > 0) throw new Error(`ingest produced ${nulls} rows with missing required fields`);

    const regionResult = await connection.run(
      "SELECT region, count(*)::int FROM stage GROUP BY region ORDER BY 2 DESC",
    );
    const regionCounts: Record<string, number> = {};
    for (const r of await regionResult.getRows()) {
      regionCounts[String(r[0])] = Number(r[1]);
    }
    if (preset.expectedRegions.length > 0) {
      // Region values must land in the known set — a mismatch means a column
      // mapping is wrong, and run-time region filters would silently match
      // nothing. Abort instead of ingesting garbage.
      const allowed = new Set<string>([...preset.expectedRegions, ...preset.extraRegions]);
      const matched = Object.entries(regionCounts)
        .filter(([region]) => allowed.has(region))
        .reduce((sum, [, n]) => sum + n, 0);
      if (matched / rows < 0.9) {
        throw new Error(
          `region validation failed: only ${Math.round((matched / rows) * 100)}% of rows match known regions (column mapping drift?)`,
        );
      }
    }

    // ── transactional swap ──
    emit({ type: "swapping" });
    const version = `${rows}-cap${cap}-${new Date().toISOString().slice(0, 10)}`;
    await connection.run("BEGIN");
    try {
      await connection.run("DELETE FROM persona WHERE country = ?", [preset.country]);
      await connection.run("INSERT INTO persona SELECT * FROM stage");
      await connection.run("DELETE FROM pool_meta WHERE country = ?", [preset.country]);
      await connection.run("INSERT INTO pool_meta VALUES (?, ?, ?, ?)", [
        preset.country,
        version,
        rows,
        new Date().toISOString(),
      ]);
      await connection.run("COMMIT");
    } catch (e) {
      await connection.run("ROLLBACK").catch(() => {});
      throw e;
    }

    return {
      country: preset.country,
      rows,
      regions: regionCounts,
      filesRead,
      filesTotal: files.length,
      version,
    };
  } finally {
    connection.closeSync();
  }
}

async function countRows(connection: DuckDBConnection, table: string): Promise<number> {
  const result = await connection.run(`SELECT count(*)::int FROM ${table}`);
  return Number((await result.getRows())[0]?.[0] ?? 0);
}
