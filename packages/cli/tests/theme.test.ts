import type { Opinion } from "@wind-tunnel/core";
import { describe, expect, it } from "vitest";
import { groupStyle, personaMeta } from "../src/render/theme";

function opinion(attributes: Partial<Opinion["attributes"]>): Opinion {
  return {
    personaId: "p",
    name: "p",
    text: "",
    attributes: {
      age: 0,
      sex: "",
      occupation: "",
      location: "",
      marital_status: "",
      ...attributes,
    },
  };
}

describe("groupStyle", () => {
  it("cycles through the accents so every group index has a color", () => {
    expect(groupStyle(0)).toBe("cyan");
    expect(groupStyle(5)).toBe(groupStyle(0));
    expect(groupStyle(6)).toBe(groupStyle(1));
  });
});

describe("personaMeta", () => {
  it("joins age, occupation and location, skipping blanks", () => {
    expect(personaMeta(opinion({ age: 34, occupation: "nurse", location: "Austin, TX" }))).toBe(
      "34 · nurse · Austin, TX",
    );
    expect(personaMeta(opinion({ occupation: "nurse" }))).toBe("nurse");
  });
});
