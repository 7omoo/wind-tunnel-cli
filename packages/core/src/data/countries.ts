// Country metadata, single source. Maps each country code in countrySchema
// (schemas.ts, the authority) to a display label and its region options.
// To add a country: extend countrySchema and defaultPersonaLang (schemas.ts),
// regions.ts, and this file together, plus a dataset preset in
// personas/presets.ts for `personas pull`.

import { type Country, countrySchema } from "../schemas";
import {
  BE_REGIONS,
  BR_STATES,
  FR_DEPARTEMENTS,
  IN_STATES,
  JP_REGIONS,
  KR_PROVINCES,
  type RegionOption,
  US_STATES,
  VN_REGIONS,
} from "./regions";

// Display order for country selection: the countrySchema enum order, derived so
// the two can never disagree.
export const COUNTRY_CODES: readonly Country[] = countrySchema.options;

export const COUNTRY_LABELS: Record<Country, string> = {
  jp: "Japan",
  usa: "USA",
  in: "India",
  br: "Brazil",
  fr: "France",
  kr: "Korea",
  vn: "Vietnam",
  be: "Belgium",
};

// country -> region options. The first entry is always "Nationwide" (filter bypass).
export const COUNTRY_TO_REGIONS: Record<Country, RegionOption[]> = {
  jp: JP_REGIONS,
  usa: US_STATES,
  in: IN_STATES,
  br: BR_STATES,
  fr: FR_DEPARTEMENTS,
  kr: KR_PROVINCES,
  vn: VN_REGIONS,
  be: BE_REGIONS,
};

// Maps a region the user typed to the value stored in the pool: the value
// itself or its display label ("CA" or "California", "関東地方" or "関東"),
// case-insensitively; Nationwide resolves to itself. undefined when the
// country has no such region.
export function resolveRegion(country: Country, input: string): string | undefined {
  const query = input.trim().toLowerCase();
  return COUNTRY_TO_REGIONS[country].find(
    (r) => r.value.toLowerCase() === query || r.label.toLowerCase() === query,
  )?.value;
}
