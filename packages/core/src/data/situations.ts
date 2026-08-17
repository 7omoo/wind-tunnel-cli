// Situation (channel/context) metadata, single source. For each situation in
// situationSchema (schemas.ts, the authority) this maps a display label and the
// length policy of persona reactions. The channel prose itself (what the place
// feels like) lives in prompts/situation.ts because it branches per language;
// this file holds only language-independent metadata.

import type { Situation } from "../schemas";

// Length-policy token. prompts/situation.ts renders it into a concrete phrase per language.
export type LengthPolicy = "two" | "one_two" | "two_three" | "free";

export type SituationMeta = {
  id: Situation;
  // Display label for CLI output and docs.
  label: string;
  lengthPolicy: LengthPolicy;
};

// Default situation. Unspecified/invalid values fall back here.
export const DEFAULT_SITUATION: Situation = "sns_viral";

// Display order: anonymous & heated -> named & measured. Must equal the situationSchema enum as a set.
export const SITUATION_CODES: readonly Situation[] = [
  "anon_board",
  "sns_viral",
  "news_comment",
  "public_comment",
  "real_sns",
  "consumer_survey",
];

export const SITUATIONS: Record<Situation, SituationMeta> = {
  anon_board: { id: "anon_board", label: "Anonymous board", lengthPolicy: "free" },
  sns_viral: { id: "sns_viral", label: "Viral social media", lengthPolicy: "one_two" },
  news_comment: { id: "news_comment", label: "News comments", lengthPolicy: "two_three" },
  public_comment: { id: "public_comment", label: "Public consultation", lengthPolicy: "two_three" },
  real_sns: { id: "real_sns", label: "Real-name social media", lengthPolicy: "one_two" },
  consumer_survey: { id: "consumer_survey", label: "Consumer survey", lengthPolicy: "two" },
};
