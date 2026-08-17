// Run store contract — the shapes written into a run directory. This layout is
// the public output format (docs/DESIGN.md §8): downstream consumers read these
// files, not a library.

import type { ModelRoles } from "../models/defaults";
import type {
  AlternativeSuggestions,
  Country,
  FlameResult,
  Opinion,
  OpinionClusterResult,
  OpinionScore,
  OutputLang,
  PersonaLang,
  RawPersona,
  Situation,
} from "../types";

// input.json — everything needed to reproduce the run (no secrets).
export type RunInput = {
  schemaVersion: 1;
  runId: string;
  createdAt: string;
  topic: string;
  country: Country;
  situation: Situation;
  personaLang: PersonaLang;
  outputLang: OutputLang;
  context?: string;
  filter: {
    ageMin?: number;
    ageMax?: number;
    sex?: string;
    region?: string;
    personaCount: number;
  };
  models: ModelRoles;
  batch: number;
};

// personas.json
export type PersonasArtifact = {
  schemaVersion: 1;
  country: Country;
  poolVersion: string;
  personas: RawPersona[];
};

// scores.json
export type ScoresArtifact = {
  schemaVersion: 1;
  scores: OpinionScore[];
};

// analyze.json = FlameResult | null, cluster.json = OpinionClusterResult | null,
// suggest.json = AlternativeSuggestions | null. A file containing `null` means
// the stage COMPLETED without a usable result (non-fatal failure); an absent
// file means the stage hasn't run — that distinction is what resume walks.
export type AnalyzeArtifact = FlameResult | null;
export type ClusterArtifact = OpinionClusterResult | null;
export type SuggestArtifact = AlternativeSuggestions | null;

export type RunStageName =
  | "filter"
  | "react"
  | "score"
  | "verdict"
  | "cluster"
  | "suggest"
  | "export";

// status.json — live progress marker plus accumulated warnings. Updated at
// stage boundaries; cheap enough to rewrite whole.
export type RunStatus = {
  schemaVersion: 1;
  stage: RunStageName | "done" | "failed";
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  error: string | null;
  warnings: string[];
};

// Progress events for a live consumer (CLI rendering). Not persisted.
export type RunProgressEvent =
  | { type: "stage"; stage: RunStageName }
  | { type: "progress"; stage: "react" | "score" | "stance"; done: number; total: number }
  | { type: "opinion"; opinion: Opinion }
  | { type: "warning"; message: string };

// Return value of executeRun — a short summary for the caller; the artifacts
// on disk are the real result.
export type RunSummary = {
  runId: string;
  dir: string;
  opinionCount: number;
  flameIndex: number | null;
  riskLevel: string | null;
  warnings: string[];
};
