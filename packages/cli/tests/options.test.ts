import { InvalidArgumentError } from "commander";
import { describe, expect, it } from "vitest";
import { integerOption } from "../src/options";

describe("integerOption", () => {
  it("parses non-negative integers", () => {
    expect(integerOption("0")).toBe(0);
    expect(integerOption("42")).toBe(42);
  });

  // parseInt would turn these into NaN or a silently truncated number, which
  // then slipped through (e.g. `detail --group abc` showed every voice).
  it.each(["abc", "", "12abc", "1.5", "-3", " 7"])("rejects %j at parse time", (value) => {
    expect(() => integerOption(value)).toThrow(InvalidArgumentError);
  });
});
