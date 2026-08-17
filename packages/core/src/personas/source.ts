// Persona pool abstraction. The pipeline depends on this interface only;
// implementations are the SQLite pool (ingest) and the JSON source (custom
// files, fixtures).

import type { Country, RawPersona } from "../types";

export type PersonaFilter = {
  country: Country;
  ageMin?: number;
  ageMax?: number;
  // Matched against sex or sex_norm. "" / "All" / undefined = no filter.
  sex?: string;
  // Matched against region. "Nationwide" / undefined = no filter.
  region?: string;
  count: number;
};

export interface PersonaSource {
  // Random sample of personas matching the filter (up to `count`).
  sample(filter: PersonaFilter): Promise<RawPersona[]>;
  // Provenance label for the pool this source draws from.
  poolVersion(country: Country): Promise<string>;
}
