import { describe, expect, it } from "vitest";
import { clip, formatDuration, progressBar } from "../src/render/format";

describe("formatDuration", () => {
  it("renders seconds, minutes and hours", () => {
    expect(formatDuration(4_000)).toBe("4s");
    expect(formatDuration(75_000)).toBe("1m15s");
    expect(formatDuration(3_725_000)).toBe("1h02m");
    expect(formatDuration(0)).toBe("0s");
  });
});

describe("progressBar", () => {
  it("fills proportionally and clamps", () => {
    expect(progressBar(0, 10, 10)).toBe("░".repeat(10));
    expect(progressBar(5, 10, 10)).toBe("█".repeat(5) + "░".repeat(5));
    expect(progressBar(10, 10, 10)).toBe("█".repeat(10));
    expect(progressBar(15, 10, 10)).toBe("█".repeat(10)); // over-done clamps
  });
});

describe("clip", () => {
  it("flattens whitespace and appends an ellipsis over the limit", () => {
    expect(clip("hello  world\n\nagain", 100)).toBe("hello world again");
    expect(clip("あいうえおかきくけこ", 5)).toBe("あいうえお…");
  });
});
