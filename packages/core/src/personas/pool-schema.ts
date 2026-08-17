// Pool database schema (a local DuckDB file). Shared by ingest (writes) and
// the pool source (reads). The persona columns mirror the RawPersona shape.

import type { DuckDBConnection } from "@duckdb/node-api";

export const POOL_DDL = [
  `CREATE TABLE IF NOT EXISTS persona (
    uuid TEXT NOT NULL,
    country TEXT NOT NULL,
    age INTEGER NOT NULL,
    sex TEXT NOT NULL,
    sex_norm TEXT,
    occupation TEXT,
    marital_status TEXT,
    education_level TEXT,
    region TEXT,
    locality TEXT,
    professional_persona TEXT,
    persona TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS pool_meta (
    country TEXT PRIMARY KEY,
    version TEXT NOT NULL,
    row_count INTEGER NOT NULL,
    ingested_at TEXT NOT NULL
  )`,
] as const;

export async function ensurePoolSchema(connection: DuckDBConnection): Promise<void> {
  for (const ddl of POOL_DDL) {
    await connection.run(ddl);
  }
}

// Column list in table order — reused by ingest INSERTs and pool SELECTs so
// the two can never disagree on ordering.
export const PERSONA_COLUMNS = [
  "uuid",
  "country",
  "age",
  "sex",
  "sex_norm",
  "occupation",
  "marital_status",
  "education_level",
  "region",
  "locality",
  "professional_persona",
  "persona",
] as const;
