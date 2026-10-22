// Country presets for `personas pull`: where each Nemotron dataset lives on
// Hugging Face and how its columns map onto the pool schema. The SQL fragments
// are DuckDB expressions over the source parquet columns.
//
// Multilingual datasets ship per-language splits; in/be use the English split
// (en_IN / en_BE), everything else a plain train split. Verified against the
// live @~parquet layout on 2026-08-17.

import { COUNTRY_TO_REGIONS } from "../data/countries";
import { regionValues } from "../data/regions";
import type { Country } from "../types";

export type CountryPreset = {
  country: Country;
  datasetId: string;
  // Split directory under `@~parquet/default/`.
  split: string;
  // DuckDB expression producing the canonical region value (matches
  // data/regions.ts option values, so run-time filters compare equal strings).
  regionSql: string;
  // DuckDB expression for the display locality.
  localitySql: string;
  // Default per-region sampling cap. France gets a lower one — 101 départements
  // would otherwise balloon the pool.
  defaultCap: number;
  // Known-good region set for ingest validation, the country's region table
  // (empty = relaxed mode: only sanity checks). `extra` values appear in the
  // data but not in the table (reachable via Nationwide only).
  expectedRegions: readonly string[];
  extraRegions: readonly string[];
};

export const COUNTRY_PRESETS: Record<Country, CountryPreset> = {
  jp: {
    country: "jp",
    datasetId: "nvidia/Nemotron-Personas-Japan",
    split: "train",
    regionSql: "region", // already the canonical macro-region ('関東地方' etc.)
    localitySql: "prefecture",
    defaultCap: 2000,
    expectedRegions: regionValues(COUNTRY_TO_REGIONS.jp),
    extraRegions: [],
  },
  usa: {
    country: "usa",
    datasetId: "nvidia/Nemotron-Personas-USA",
    split: "train",
    regionSql: "upper(state)",
    localitySql: "concat(city, ', ', state)",
    defaultCap: 400,
    expectedRegions: regionValues(COUNTRY_TO_REGIONS.usa),
    extraRegions: ["PR"],
  },
  in: {
    country: "in",
    datasetId: "nvidia/Nemotron-Personas-India",
    split: "en_IN",
    regionSql: "state",
    localitySql: "district",
    defaultCap: 500,
    expectedRegions: [],
    extraRegions: [],
  },
  br: {
    country: "br",
    datasetId: "nvidia/Nemotron-Personas-Brazil",
    split: "train",
    regionSql: "state",
    localitySql: "municipality",
    defaultCap: 600,
    expectedRegions: [],
    extraRegions: [],
  },
  fr: {
    country: "fr",
    datasetId: "nvidia/Nemotron-Personas-France",
    split: "train",
    regionSql: "departement",
    localitySql: "commune",
    defaultCap: 200,
    expectedRegions: [],
    extraRegions: [],
  },
  kr: {
    country: "kr",
    datasetId: "nvidia/Nemotron-Personas-Korea",
    split: "train",
    regionSql: "province",
    localitySql: "district",
    defaultCap: 1000,
    expectedRegions: [],
    extraRegions: [],
  },
  vn: {
    country: "vn",
    datasetId: "nvidia/Nemotron-Personas-Vietnam",
    split: "train",
    regionSql: "region",
    localitySql: "zone",
    defaultCap: 300,
    expectedRegions: [],
    extraRegions: [],
  },
  be: {
    country: "be",
    datasetId: "nvidia/Nemotron-Personas-Belgium",
    split: "en_BE",
    regionSql: "region",
    localitySql: "municipality",
    defaultCap: 5000,
    expectedRegions: [],
    extraRegions: [],
  },
};

export function presetGlob(preset: CountryPreset): string {
  return `hf://datasets/${preset.datasetId}@~parquet/default/${preset.split}/*.parquet`;
}

// Raw sex value -> M/F. Covers every per-locale encoding across the eight
// datasets (男/Male/Homme/남자/Masculino/Nam, ...). Unknown values stay NULL —
// they remain reachable when no sex filter is applied.
export const SEX_NORM_SQL =
  "CASE WHEN sex IN ('男','Male','male','M','m','Homme','남자','Masculino','Nam') THEN 'M' " +
  "WHEN sex IN ('女','Female','female','F','f','Femme','여자','Femenino','Feminino','Nữ') THEN 'F' END";
