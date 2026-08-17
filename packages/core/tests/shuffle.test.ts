import { describe, expect, it } from "vitest";
import { shuffle } from "../src/util/shuffle";

describe("shuffle", () => {
  it("returns a permutation: same elements, same length, edge sizes included", () => {
    const input = Array.from({ length: 20 }, (_, i) => i);
    expect([...shuffle(input)].sort((a, b) => a - b)).toEqual(input);
    expect(shuffle([])).toEqual([]);
    expect(shuffle([7])).toEqual([7]);
  });

  it("does not mutate its input", () => {
    const input = [1, 2, 3, 4, 5];
    const snapshot = [...input];
    shuffle(input);
    expect(input).toEqual(snapshot);
  });

  it("actually reorders (20 elements: identity odds are ~1/20!, not flake territory)", () => {
    const input = Array.from({ length: 20 }, (_, i) => i);
    expect(shuffle(input)).not.toEqual(input);
  });
});
