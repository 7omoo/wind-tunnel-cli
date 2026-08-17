// PersonaSource over the local pool database (DuckDB file written by
// `personas pull`). Opened read-only so a sampling run never blocks or
// corrupts a concurrent pull.

import { access } from "node:fs/promises";
import { DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
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
      if (filter.region && filter.region !== "Nationwide") {
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
      const rows = await result.getRows();
      return rows.map((r) => ({
        uuid: String(r[0]),
        country: String(r[1]),
        age: Number(r[2]),
        sex: String(r[3]),
        sex_norm: r[4] === null ? undefined : String(r[4]),
        occupation: String(r[5] ?? ""),
        marital_status: String(r[6] ?? ""),
        education_level: r[7] === null ? undefined : String(r[7]),
        region: r[8] === null ? undefined : String(r[8]),
        locality: r[9] === null ? undefined : String(r[9]),
        professional_persona: String(r[10] ?? ""),
        persona: String(r[11] ?? ""),
      }));
    },

    async poolVersion(country: Country): Promise<string> {
      const result = await connection.run("SELECT version FROM pool_meta WHERE country = ?", [
        country,
      ]);
      const rows = await result.getRows();
      return rows[0] ? String(rows[0][0]) : `none-${country}`;
    },

    async list(): Promise<PoolInfo[]> {
      const result = await connection.run(
        "SELECT country, version, row_count::int, ingested_at FROM pool_meta ORDER BY country",
      );
      return (await result.getRows()).map((r) => ({
        country: String(r[0]),
        version: String(r[1]),
        rowCount: Number(r[2]),
        ingestedAt: String(r[3]),
      }));
    },

    close(): void {
      connection.closeSync();
    },
  };
}

export function defaultPoolPath(dataRootDir: string): string {
  return `${dataRootDir}/personas.duckdb`;
}
