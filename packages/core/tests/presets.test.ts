import { DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import { describe, expect, it } from "vitest";
import { NATIONWIDE } from "../src/data/regions";
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

  // jp and usa validate ingest against their region tables; the others run
  // relaxed. The bypass entry is never a region to expect.
  it("expects the region tables' values for jp (8 regions) and usa (50 states + DC, PR extra)", () => {
    expect(COUNTRY_PRESETS.jp.expectedRegions).toHaveLength(8);
    expect(COUNTRY_PRESETS.usa.expectedRegions).toHaveLength(51);
    expect(COUNTRY_PRESETS.usa.extraRegions).toContain("PR");
    for (const preset of Object.values(COUNTRY_PRESETS)) {
      expect(preset.expectedRegions).not.toContain(NATIONWIDE);
    }
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

describe("SEX_NORM_SQL", () => {
  // Evaluated by DuckDB itself, exactly as ingest embeds it.
  it("maps each dataset's spelling to M / F and anything else to NULL", async () => {
    const values = [
      "男",
      "Male",
      "Homme",
      "남자",
      "Nam",
      "女",
      "Female",
      "Femme",
      "Feminino",
      "Nữ",
      "other",
      "",
    ];
    const instance = await DuckDBInstance.create(":memory:");
    const connection = await DuckDBConnection.create(instance);
    try {
      const rows = values.map((v) => `('${v}')`).join(", ");
      const result = await connection.run(`SELECT ${SEX_NORM_SQL} FROM (VALUES ${rows}) AS t(sex)`);
      expect((await result.getRows()).map((r) => r[0])).toEqual([
        "M",
        "M",
        "M",
        "M",
        "M",
        "F",
        "F",
        "F",
        "F",
        "F",
        null,
        null,
      ]);
    } finally {
      connection.closeSync();
    }
  });
});
