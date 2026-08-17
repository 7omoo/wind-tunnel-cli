// One case per extraction pattern in extractName — the Nemotron datasets phrase
// the leading sentence differently per locale, and each branch exists because a
// real dataset needed it.

import { describe, expect, it } from "vitest";
import { extractName } from "../src/personas/names";

describe("extractName", () => {
  it('takes the segment before ", a " (the usa/in/br phrasing)', () => {
    expect(extractName("Ashley Carter, a nurse from Austin who...", "usa")).toBe("Ashley Carter");
    expect(extractName("José Álvarez, a chef in Madrid...", "usa")).toBe("José Álvarez");
  });

  it('takes the segment before " is " when there is no appositive comma', () => {
    expect(extractName("John Smith is a teacher who...", "usa")).toBe("John Smith");
    // Non-Latin scripts ride the same branch (kr/vn English splits).
    expect(extractName("김민준 is a designer in Seoul...", "kr")).toBe("김민준");
  });

  it('finds "named <Name>" mid-sentence', () => {
    expect(
      extractName("A 45-year-old accountant named Maria Gonzalez working in Lyon...", "fr"),
    ).toBe("Maria Gonzalez");
  });

  it("accepts a leading titled name (Dr./Prof. etc.)", () => {
    expect(extractName("Dr. Emily Carter treats patients in rural Ohio...", "usa")).toBe(
      "Dr. Emily Carter",
    );
  });

  it("falls back to the first three tokens when no pattern matches", () => {
    expect(extractName("veteran firefighter from rural Kerala, India", "in")).toBe(
      "veteran firefighter from",
    );
  });

  it('cuts before "は" for jp prose', () => {
    expect(extractName("田中太郎は、横浜市在住の34歳の看護師。", "jp")).toBe("田中太郎");
  });
});
