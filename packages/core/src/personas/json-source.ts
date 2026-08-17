// In-memory PersonaSource over a JSON pool. Serves custom persona files and
// test fixtures; country presets use the SQLite pool instead.

import { readFile } from "node:fs/promises";
import type { Country, RawPersona } from "../types";
import { shuffle } from "../util/shuffle";
import type { PersonaFilter, PersonaSource } from "./source";

export function createJsonPersonaSource(opts: {
  personas: RawPersona[];
  version?: string;
}): PersonaSource {
  const version = opts.version ?? `json-${opts.personas.length}`;
  return {
    async sample(filter: PersonaFilter): Promise<RawPersona[]> {
      const matched = opts.personas.filter((p) => matches(p, filter));
      return shuffle(matched).slice(0, filter.count);
    },
    async poolVersion(_country: Country): Promise<string> {
      return version;
    },
  };
}

// Load a pool from disk: either a bare array or { personas: [...] }.
export async function loadJsonPersonaSource(filePath: string): Promise<PersonaSource> {
  const raw = JSON.parse(await readFile(filePath, "utf8")) as
    | RawPersona[]
    | { personas?: RawPersona[]; version?: string };
  const personas = Array.isArray(raw) ? raw : (raw.personas ?? []);
  if (personas.length === 0) throw new Error(`no personas found in ${filePath}`);
  const version = Array.isArray(raw) ? undefined : raw.version;
  return createJsonPersonaSource({ personas, version });
}

function matches(p: RawPersona, f: PersonaFilter): boolean {
  // Rows without a country belong to single-country custom pools — accepted as-is.
  if (p.country && p.country !== f.country) return false;
  if (f.ageMin !== undefined && p.age < f.ageMin) return false;
  if (f.ageMax !== undefined && p.age > f.ageMax) return false;
  if (f.sex && f.sex !== "All" && p.sex !== f.sex && p.sex_norm !== f.sex) return false;
  if (f.region && f.region !== "Nationwide" && p.region !== f.region) return false;
  return true;
}
