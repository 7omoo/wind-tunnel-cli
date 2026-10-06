// Presentation vocabulary shared by the summary, `detail`, and the live
// progress view, so a sentiment, a group, or a voice looks the same everywhere.

import type { Opinion, Sentiment } from "@wind-tunnel/core";
import type { paint } from "./format";

export type Style = Parameters<typeof paint>[0];

export const SENTIMENT_STYLE: Record<Sentiment, Style> = {
  critical: "red",
  neutral: "gray",
  favorable: "green",
};

// Group accents cycle through distinct colors.
const GROUP_STYLES: Style[] = ["cyan", "magenta", "yellow", "blue", "green"];

export function groupStyle(index: number): Style {
  return GROUP_STYLES[index % GROUP_STYLES.length] ?? "cyan";
}

// "34 · nurse · Austin, TX" — the attribution line under a voice.
export function personaMeta(opinion: Opinion): string {
  const a = opinion.attributes;
  return [a.age ? String(a.age) : "", a.occupation, a.location].filter(Boolean).join(" · ");
}
