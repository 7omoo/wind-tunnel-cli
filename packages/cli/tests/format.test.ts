import { describe, expect, it } from "vitest";
import {
  clip,
  displayWidth,
  formatDuration,
  gauge,
  progressBar,
  segmentedBar,
  wrap,
} from "../src/render/format";

describe("gauge", () => {
  it("fills by value with a dim remainder (colors off)", () => {
    expect(gauge(50, 100, 10, "red", false)).toBe("█".repeat(5) + "░".repeat(5));
    expect(gauge(0, 100, 10, "red", false)).toBe("░".repeat(10));
    expect(gauge(150, 100, 10, "red", false)).toBe("█".repeat(10)); // clamps
  });
});

describe("segmentedBar", () => {
  const plain = (counts: number[], width: number) =>
    segmentedBar(
      counts.map((count) => ({ count, style: "red" as const })),
      width,
      false,
    );

  it("splits the width proportionally and always sums exactly to width", () => {
    expect(plain([5, 5], 10)).toBe("█".repeat(10));
    for (const counts of [
      [7, 3, 5],
      [1, 1, 1],
      [99, 1, 0],
      [14, 3, 3],
    ]) {
      expect(plain(counts, 24).length).toBe(24);
    }
  });

  it("keeps non-zero segments visible even when they round to zero", () => {
    // 1 of 100 rounds to 0 cells; the green segment must keep one.
    const bar = segmentedBar(
      [
        { count: 99, style: "red" },
        { count: 1, style: "green" },
      ],
      20,
      true,
    );
    expect(bar).toContain("[32m"); // the green escape survives
  });

  it("renders an empty total as a dim track", () => {
    expect(segmentedBar([], 10, false)).toBe("░".repeat(10));
    expect(segmentedBar([{ count: 0, style: "red" }], 10, false)).toBe("░".repeat(10));
  });
});

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

describe("displayWidth", () => {
  it("counts CJK as two columns and Latin as one", () => {
    expect(displayWidth("hello")).toBe(5);
    expect(displayWidth("こんにちは")).toBe(10);
    expect(displayWidth("徹夜明けabc")).toBe(11);
    expect(displayWidth("한국어")).toBe(6);
    expect(displayWidth("、。「」")).toBe(8); // CJK punctuation
  });
});

describe("clip (display-width aware)", () => {
  it("flattens whitespace and clips by display width", () => {
    expect(clip("hello  world\n\nagain", 100)).toBe("hello world again");
    // 10 Japanese chars = 20 columns; a 10-column budget keeps ~4 chars + ellipsis.
    const clipped = clip("あいうえおかきくけこ", 10);
    expect(clipped.endsWith("…")).toBe(true);
    expect(displayWidth(clipped)).toBeLessThanOrEqual(10);
  });

  it("returns short text unchanged", () => {
    expect(clip("短い", 10)).toBe("短い");
  });
});

describe("wrap", () => {
  it("wraps CJK prose at the display width", () => {
    const text = "健康への配慮が欠如していると感じられる表現が多数の批判を引き起こしている。";
    const lines = wrap(text, 30);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(displayWidth(line)).toBeLessThanOrEqual(30);
    }
    expect(lines.join("")).toBe(text); // no characters lost
  });

  it("applies the hanging indent to continuation lines only", () => {
    const lines = wrap("あ".repeat(30), 20, "  ");
    expect(lines[0]?.startsWith("  ")).toBe(false);
    for (const line of lines.slice(1)) {
      expect(line.startsWith("  ")).toBe(true);
      expect(displayWidth(line)).toBeLessThanOrEqual(20);
    }
  });

  it("breaks Latin text at spaces, keeping words whole", () => {
    const lines = wrap("the quick brown fox jumps over the lazy dog", 15);
    for (const line of lines) {
      expect(displayWidth(line)).toBeLessThanOrEqual(15);
      expect(line.startsWith(" ")).toBe(false);
      expect(line.endsWith(" ")).toBe(false);
    }
    expect(lines.join(" ")).toBe("the quick brown fox jumps over the lazy dog");
  });

  it("handles empty and single-line input", () => {
    expect(wrap("", 20)).toEqual([]);
    expect(wrap("short", 20)).toEqual(["short"]);
  });
});
