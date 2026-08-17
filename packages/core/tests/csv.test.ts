import { describe, expect, it } from "vitest";
import type { Opinion } from "../src/types";
import { opinionsToCsv, safeFilename } from "../src/util/csv";

function opinion(overrides: Partial<Opinion> = {}): Opinion {
  return {
    personaId: "usa-001",
    name: "Ashley Carter",
    text: "Feels like a fair offer.",
    attributes: {
      age: 34,
      sex: "F",
      occupation: "nurse",
      location: "Austin",
      marital_status: "married",
    },
    ...overrides,
  };
}

describe("opinionsToCsv", () => {
  it("starts with a UTF-8 BOM and uses CRLF endings (the Excel contract)", () => {
    const csv = opinionsToCsv([opinion()], { runId: "r1" });
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv).not.toMatch(/[^\r]\n/); // no bare LF anywhere
  });

  it('quotes and doubles per RFC 4180 when a value contains , " or newlines', () => {
    const csv = opinionsToCsv([opinion({ text: 'She said "no, thanks"\nand left.' })], {
      runId: "r1",
      topic: "a, b",
    });
    expect(csv).toContain('"She said ""no, thanks""\nand left."');
    expect(csv).toContain('"a, b"');
  });

  it("leaves plain values unquoted and renders missing context as empty fields", () => {
    const csv = opinionsToCsv([opinion()]);
    const row = csv.split("\r\n")[1];
    expect(row).toBe(",,,usa-001,Ashley Carter,34,F,nurse,Austin,married,Feels like a fair offer.");
  });

  it("keeps formula-like text verbatim (re-analysis over Excel-side escaping)", () => {
    // Deliberate: prefixing '=... with an apostrophe would protect Excel but
    // corrupt the value for pandas/R/SPSS, the primary consumers of this file.
    const csv = opinionsToCsv([opinion({ text: "=SUM(A1:A9)" })]);
    expect(csv).toContain(",=SUM(A1:A9)");
  });
});

describe("safeFilename", () => {
  it("reduces non-ASCII and specials to single dashes and caps the stem at 60", () => {
    expect(safeFilename("炎上リスク: 夏のキャンペーン!!", "csv")).toBe("-.csv");
    expect(safeFilename("Summer  Campaign / v2", "csv")).toBe("Summer-Campaign-v2.csv");
    expect(safeFilename("x".repeat(80), "csv")).toBe(`${"x".repeat(60)}.csv`);
  });

  it("falls back to 'export' when nothing survives", () => {
    expect(safeFilename("", "csv")).toBe("export.csv");
  });
});
