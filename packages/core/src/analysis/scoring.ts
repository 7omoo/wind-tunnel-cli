// Sentiment classification and aggregation — the single source of truth for
// cutting the per-opinion scores (-100..+100) into critical / neutral / favorable.
// Every consumer (terminal summary, CSV, map coloring) goes through this module
// so the classification can never drift between outputs. Presentation colors are
// deliberately NOT here — the CLI maps Sentiment to ANSI on its own.

// Scores at or above this value are favorable; at or below the negative, critical.
// The boundary (exactly +/-20) belongs to the favorable/critical side (<=, >=),
// an asymmetry carried over from the original implementation on purpose.
export const SENTIMENT_THRESHOLD = 20;

export type Sentiment = "critical" | "neutral" | "favorable";

export type ScoreLike = { score: number };

export function classifySentiment(score: number): Sentiment {
  if (score <= -SENTIMENT_THRESHOLD) return "critical";
  if (score >= SENTIMENT_THRESHOLD) return "favorable";
  return "neutral";
}

export type SentimentCounts = Record<Sentiment, number>;

export function sentimentCounts(scores: ScoreLike[]): SentimentCounts {
  const counts: SentimentCounts = { critical: 0, neutral: 0, favorable: 0 };
  for (const s of scores) counts[classifySentiment(s.score)] += 1;
  return counts;
}

// Returns the three buckets sorted: critical ascending (most critical first),
// favorable descending, neutral descending.
export function bucketScores<T extends ScoreLike>(items: T[]): Record<Sentiment, T[]> {
  const critical: T[] = [];
  const favorable: T[] = [];
  const neutral: T[] = [];
  for (const it of items) {
    const tier = classifySentiment(it.score);
    if (tier === "critical") critical.push(it);
    else if (tier === "favorable") favorable.push(it);
    else neutral.push(it);
  }
  critical.sort((a, b) => a.score - b.score);
  favorable.sort((a, b) => b.score - a.score);
  neutral.sort((a, b) => b.score - a.score);
  return { critical, neutral, favorable };
}

export function percentages(counts: SentimentCounts, total: number): SentimentCounts {
  if (total === 0) return { critical: 0, neutral: 0, favorable: 0 };
  return {
    critical: Math.round((counts.critical / total) * 100),
    neutral: Math.round((counts.neutral / total) * 100),
    favorable: Math.round((counts.favorable / total) * 100),
  };
}

export function averageScore(scores: ScoreLike[]): number {
  if (scores.length === 0) return 0;
  return Math.round(scores.reduce((sum, s) => sum + s.score, 0) / scores.length);
}
