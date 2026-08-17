import type { Opinion, OpinionScore } from "@wind-tunnel/core";
import { describe, expect, it } from "vitest";
import { wrapLines } from "../src/render/format";
import { firstSentence, pickGroupVoices } from "../src/render/summary";

function opinion(id: string, text = `声 ${id}`): Opinion {
  return {
    personaId: id,
    name: id,
    text,
    attributes: { age: 30, sex: "", occupation: "会社員", location: "東京都", marital_status: "" },
  };
}
const score = (personaId: string, value: number): OpinionScore => ({
  personaId,
  score: value,
  reason: "",
});

describe("firstSentence", () => {
  it("keeps only the opening claim (ja and en)", () => {
    expect(firstSentence("炎上リスクは高い。特に健康層の反発が強い。")).toBe("炎上リスクは高い。");
    expect(firstSentence("Backlash is likely. Health-minded users object.")).toBe(
      "Backlash is likely.",
    );
  });

  it("falls back to a clip when there is no sentence break", () => {
    expect(firstSentence("句点のない長い文章".repeat(2))).toContain("句点のない");
  });
});

describe("pickGroupVoices", () => {
  const opinions = ["a", "b", "c", "d", "e"].map((id) => opinion(id));
  const scores = [
    score("a", -80),
    score("b", -40),
    score("c", -35),
    score("d", -30),
    score("e", 60),
  ];

  it("returns the most typical member first, then the loudest contrast", () => {
    const picked = pickGroupVoices(["a", "b", "c", "d", "e"], opinions, scores);
    expect(picked).toHaveLength(2);
    // mean = -25; closest is d (-30), farthest from mean is e (+60).
    expect(picked[0]?.opinion.personaId).toBe("d");
    expect(picked[1]?.opinion.personaId).toBe("e");
  });

  it("handles single-member groups and unknown ids", () => {
    expect(pickGroupVoices(["a"], opinions, scores)).toHaveLength(1);
    expect(pickGroupVoices(["nope"], opinions, scores)).toHaveLength(0);
    expect(pickGroupVoices([], opinions, scores)).toHaveLength(0);
  });

  it("never picks the same member twice", () => {
    const picked = pickGroupVoices(["a", "b"], opinions, scores);
    expect(new Set(picked.map((p) => p.opinion.personaId)).size).toBe(picked.length);
  });
});

describe("wrapLines", () => {
  it("clamps to the line budget with a width-safe ellipsis", () => {
    const lines = wrapLines("あ".repeat(100), 20, "", 2);
    expect(lines).toHaveLength(2);
    expect(lines[1]?.endsWith("…")).toBe(true);
  });

  it("leaves short text untouched", () => {
    expect(wrapLines("短い", 20, "", 2)).toEqual(["短い"]);
  });
});
