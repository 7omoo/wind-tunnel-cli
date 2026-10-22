import { describe, expect, it } from "vitest";
import { COUNTRY_TO_REGIONS, resolveRegion } from "../src/data/countries";
import { NATIONWIDE, type RegionOption, regionValues } from "../src/data/regions";
import type { Country } from "../src/schemas";

describe("resolveRegion", () => {
  it("accepts the pool value, its display label, or Nationwide", () => {
    expect(resolveRegion("usa", "CA")).toBe("CA");
    expect(resolveRegion("usa", "California")).toBe("CA");
    expect(resolveRegion("jp", "関東地方")).toBe("関東地方");
    expect(resolveRegion("jp", "関東")).toBe("関東地方");
    expect(resolveRegion("usa", NATIONWIDE)).toBe(NATIONWIDE);
  });

  it("ignores case and surrounding whitespace", () => {
    expect(resolveRegion("usa", " california ")).toBe("CA");
    expect(resolveRegion("usa", "ca")).toBe("CA");
  });

  it("is undefined for a region the country does not have", () => {
    expect(resolveRegion("usa", "Mars")).toBeUndefined();
    expect(resolveRegion("jp", "CA")).toBeUndefined();
  });

  // Proves no label collides with another option's value or label.
  it("round-trips every value and label of every country", () => {
    for (const [country, options] of Object.entries(COUNTRY_TO_REGIONS) as [
      Country,
      RegionOption[],
    ][]) {
      for (const option of options) {
        expect(resolveRegion(country, option.value)).toBe(option.value);
        expect(resolveRegion(country, option.label)).toBe(option.value);
      }
    }
  });
});

describe("regionValues", () => {
  it("lists the pool values without the Nationwide bypass", () => {
    const values = regionValues(COUNTRY_TO_REGIONS.jp);
    expect(values).toHaveLength(8);
    expect(values).not.toContain(NATIONWIDE);
  });
});
