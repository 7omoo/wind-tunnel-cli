import { describe, expect, it } from "vitest";
import { COUNTRY_TO_REGIONS } from "../src/data/countries";
import { COUNTRY_PRESETS, presetGlob, SEX_NORM_SQL } from "../src/personas/presets";
import { countrySchema } from "../src/schemas";

describe("country presets", () => {
  it("covers every country in the schema", () => {
    for (const country of countrySchema.options) {
      const preset = COUNTRY_PRESETS[country];
      expect(preset, `preset missing for ${country}`).toBeDefined();
      expect(preset.country).toBe(country);
      expect(preset.datasetId).toMatch(/^nvidia\/Nemotron-Personas-/);
      expect(preset.defaultCap).toBeGreaterThan(0);
    }
  });

  it("jp expected regions equal the region options (minus Nationwide)", () => {
    const optionValues = COUNTRY_TO_REGIONS.jp
      .map((r) => r.value)
      .filter((v) => v !== "Nationwide");
    expect([...COUNTRY_PRESETS.jp.expectedRegions].sort()).toEqual([...optionValues].sort());
  });

  it("usa expected regions equal the state options (minus Nationwide), PR allowed as extra", () => {
    const optionValues = COUNTRY_TO_REGIONS.usa
      .map((r) => r.value)
      .filter((v) => v !== "Nationwide");
    expect([...COUNTRY_PRESETS.usa.expectedRegions].sort()).toEqual([...optionValues].sort());
    expect(COUNTRY_PRESETS.usa.extraRegions).toContain("PR");
  });

  it("multilingual datasets use their English split", () => {
    expect(COUNTRY_PRESETS.in.split).toBe("en_IN");
    expect(COUNTRY_PRESETS.be.split).toBe("en_BE");
    expect(COUNTRY_PRESETS.jp.split).toBe("train");
  });

  it("builds hf:// globs on the auto-converted parquet revision", () => {
    expect(presetGlob(COUNTRY_PRESETS.jp)).toBe(
      "hf://datasets/nvidia/Nemotron-Personas-Japan@~parquet/default/train/*.parquet",
    );
  });

  it("sex normalization covers every locale encoding in the datasets", () => {
    for (const raw of ["男", "Male", "Homme", "남자", "Masculino", "Nam"]) {
      expect(SEX_NORM_SQL).toContain(`'${raw}'`);
    }
    for (const raw of ["女", "Female", "Femme", "여자", "Feminino", "Nữ"]) {
      expect(SEX_NORM_SQL).toContain(`'${raw}'`);
    }
  });
});
