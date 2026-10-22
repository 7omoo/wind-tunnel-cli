import { describe, expect, it } from "vitest";
import {
  averageScore,
  classifySentiment,
  percentages,
  SENTIMENT_THRESHOLD,
  sentimentCounts,
} from "../src/analysis/scoring";

describe("classifySentiment", () => {
  it("classifies clear scores", () => {
    expect(classifySentiment(80)).toBe("favorable");
    expect(classifySentiment(0)).toBe("neutral");
    expect(classifySentiment(-80)).toBe("critical");
  });

  it("includes the boundary on the favorable/critical side (<=, >=), not neutral", () => {
    // Deliberate asymmetry carried over from the original implementation:
    // exactly +/-20 belongs to favorable/critical, not neutral.
    expect(classifySentiment(SENTIMENT_THRESHOLD)).toBe("favorable"); // +20
    expect(classifySentiment(-SENTIMENT_THRESHOLD)).toBe("critical"); // -20
    expect(classifySentiment(19)).toBe("neutral");
    expect(classifySentiment(-19)).toBe("neutral");
  });
});

describe("sentimentCounts", () => {
  it("counts each tier", () => {
    const scores = [{ score: -50 }, { score: -20 }, { score: 0 }, { score: 20 }, { score: 90 }];
    expect(sentimentCounts(scores)).toEqual({ critical: 2, neutral: 1, favorable: 2 });
  });
});

describe("percentages", () => {
  it("rounds and guards zero total", () => {
    expect(percentages({ critical: 6, neutral: 48, favorable: 46 }, 100)).toEqual({
      critical: 6,
      neutral: 48,
      favorable: 46,
    });
    expect(percentages({ critical: 0, neutral: 0, favorable: 0 }, 0)).toEqual({
      critical: 0,
      neutral: 0,
      favorable: 0,
    });
  });
});

describe("averageScore", () => {
  it("rounds the mean and guards empty", () => {
    expect(averageScore([{ score: 10 }, { score: 20 }, { score: 30 }])).toBe(20);
    expect(averageScore([])).toBe(0);
  });
});
