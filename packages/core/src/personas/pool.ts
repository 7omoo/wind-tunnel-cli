// PersonaSource over the local pool database (DuckDB file written by
// `personas pull`). Opened read-only so a sampling run never blocks or
// corrupts a concurrent pull.

import { access } from "node:fs/promises";
import { join } from "node:path";
import { DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import { NATIONWIDE } from "../data/regions";
import type { Country, RawPersona } from "../types";
import { PERSONA_COLUMNS } from "./pool-schema";
import type { PersonaFilter, PersonaSource } from "./source";

export type PoolInfo = {
  country: string;
  version: string;
  rowCount: number;
  ingestedAt: string;
};

export type PersonaPool = PersonaSource & {
  list(): Promise<PoolInfo[]>;
  close(): void;
};

// Nullable text columns: NULL -> undefined, RawPersona's optional fields.
function optionalText(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
}

export async function poolExists(poolPath: string): Promise<boolean> {
  try {
    await access(poolPath);
    return true;
  } catch {
    return false;
  }
}

export async function openPersonaPool(poolPath: string): Promise<PersonaPool> {
  const instance = await DuckDBInstance.create(poolPath, { access_mode: "READ_ONLY" });
  const connection = await DuckDBConnection.create(instance);

  return {
    async sample(filter: PersonaFilter): Promise<RawPersona[]> {
      const conds: string[] = ["country = ?"];
      const params: (string | number)[] = [filter.country];
      if (filter.ageMin !== undefined) {
        conds.push("age >= ?");
        params.push(filter.ageMin);
      }
      if (filter.ageMax !== undefined) {
        conds.push("age <= ?");
        params.push(filter.ageMax);
      }
      if (filter.sex && filter.sex !== "All") {
        // Accept both the normalized code (M/F) and a raw per-locale value.
        conds.push("(sex_norm = ? OR sex = ?)");
        params.push(filter.sex, filter.sex);
      }
      if (filter.region && filter.region !== NATIONWIDE) {
        conds.push("region = ?");
        params.push(filter.region);
      }
      params.push(filter.count);
      const result = await connection.run(
        `SELECT ${PERSONA_COLUMNS.join(", ")} FROM persona
         WHERE ${conds.join(" AND ")}
         ORDER BY random() LIMIT ?`,
        params,
      );
      const rows = await result.getRowObjects();
      return rows.map((row) => ({
        uuid: String(row.uuid),
        country: String(row.country),
        age: Number(row.age),
        sex: String(row.sex),
        sex_norm: optionalText(row.sex_norm),
        occupation: String(row.occupation ?? ""),
        marital_status: String(row.marital_status ?? ""),
        education_level: optionalText(row.education_level),
        region: optionalText(row.region),
        locality: optionalText(row.locality),
        professional_persona: String(row.professional_persona ?? ""),
        persona: String(row.persona ?? ""),
      }));
    },

    async poolVersion(country: Country): Promise<string> {
      const result = await connection.run("SELECT version FROM pool_meta WHERE country = ?", [
        country,
      ]);
      const [row] = await result.getRowObjects();
      return row ? String(row.version) : `none-${country}`;
    },

    async list(): Promise<PoolInfo[]> {
      const result = await connection.run(
        `SELECT country, version, row_count::int AS row_count, ingested_at
         FROM pool_meta ORDER BY country`,
      );
      return (await result.getRowObjects()).map((row) => ({
        country: String(row.country),
        version: String(row.version),
        rowCount: Number(row.row_count),
        ingestedAt: String(row.ingested_at),
      }));
    },

    close(): void {
      connection.closeSync();
    },
  };
}

export function defaultPoolPath(dataRootDir: string): string {
  return join(dataRootDir, "personas.duckdb");
}
