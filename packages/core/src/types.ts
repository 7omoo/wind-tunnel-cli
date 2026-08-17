// Domain types. Enums and LLM output shapes are authored as Zod schemas in
// schemas.ts and re-derived here via z.infer, so types and validators never drift.
import type { z } from "zod";
import type {
  Country as _Country,
  OutputLang as _OutputLang,
  PersonaLang as _PersonaLang,
  RiskLevel as _RiskLevel,
  Situation as _Situation,
  flameResultSchema,
  llmOpinionScoreSchema,
  llmTriggerSchema,
} from "./schemas";

export type Country = _Country;
export type OutputLang = _OutputLang;
export type PersonaLang = _PersonaLang;
export type Situation = _Situation;
export type RiskLevel = _RiskLevel;

// One persona's reaction to the message.
export type Opinion = {
  personaId: string;
  name: string;
  text: string;
  attributes: {
    age: number;
    sex: string;
    occupation: string;
    location: string;
    marital_status: string;
  };
};

// Raw persona pool row (Nemotron-derived column names, snake_case). The ingest
// step writes these columns; the reaction stage reads them. ethnicity/religion
// stay nullable for custom pools that carry them — v1 prompts don't consume them.
export type RawPersona = {
  uuid: string;
  country?: string;
  age: number;
  sex: string;
  sex_norm?: string;
  occupation: string;
  marital_status: string;
  education_level?: string;
  region?: string;
  locality?: string;
  professional_persona: string;
  persona: string;
  ethnicity?: string | null;
  religion?: string | null;
};

// === Verdict (analyze stage) ===

export type Trigger = z.infer<typeof llmTriggerSchema>;
export type OpinionScore = z.infer<typeof llmOpinionScoreSchema>;

// Raw LLM verdict output (flameResultSchema). Loose, so unrecognized fields pass through.
export type FlameResultCore = z.infer<typeof flameResultSchema>;

// Derived fields attached after the LLM call (not LLM output).
export type FlameResultExtras = {
  // personaId -> index into triggers[], for coloring reactions by trigger.
  triggerAssignment?: Record<string, number>;
};

export type FlameResult = FlameResultCore & FlameResultExtras;

// === Opinion clustering ===

// x/y are the projection onto PC1/PC2 (default axes). coords carries the top-k
// principal components (coords[0]=PC1=x, ...) so a map can put any two on x/y.
export type PlotPoint = { personaId: string; x: number; y: number; coords?: number[] };

// One principal-component axis: label ("A <-> B") plus explained variance in %.
export type OpinionAxis = { label: string; variancePct: number };

export type OpinionClusterProposition = {
  id: string;
  text: string;
};

export type OpinionCluster = {
  id: number;
  size: number;
  centroid: number[];
  memberIds: string[];
};

export type OpinionClusterConsensus = {
  propositionId: string;
  text: string;
  score: number;
  groupSupport: number[];
};

export type OpinionClusterDivisive = {
  propositionId: string;
  text: string;
  spread: number;
  groupSupport: number[];
};

export type OpinionClusterGroupProfile = {
  clusterId: number;
  name: string;
  coreBelief: string;
  keyValues: string[];
  representativeQuote: string;
};

export type OpinionClusterBridging = {
  propositionId: string;
  text: string;
  bridgingScore: number;
  minGroupSupport: number;
  groupSupport: number[];
};

export type OpinionClusterMinorityReport = {
  clusterId: number;
  clusterSize: number;
  totalSize: number;
  narrative: string;
  blindSpots: string[];
  topDivergences: {
    propositionId: string;
    text: string;
    minorityStance: number;
    overallStance: number;
  }[];
};

export type OpinionClusterResult = {
  propositions: OpinionClusterProposition[];
  clusters: OpinionCluster[];
  plotData: PlotPoint[];
  consensus: OpinionClusterConsensus[];
  divisive: OpinionClusterDivisive[];
  xAxisLabel: string;
  yAxisLabel: string;
  // Top-k principal components (axes[0]=PC1, ...). Selector options for the map.
  axes?: OpinionAxis[];
  groupProfiles?: OpinionClusterGroupProfile[];
  bridging?: OpinionClusterBridging[];
  minorityReport?: OpinionClusterMinorityReport | null;
};

// === Suggestions (suggest stage) ===

// One alternative rewrite. QUALITATIVE only — estimatedRiskReduction is the
// model's self-assessment, not a re-measured score.
export type AlternativeSuggestion = {
  id: string;
  text: string;
  strategy: string;
  targetTriggers: number[]; // indexes into FlameResult.triggers[] (may be empty)
  estimatedRiskReduction: "High" | "Medium" | "Low";
  reasoning: string;
};

export type AlternativeSuggestions = {
  alternatives: AlternativeSuggestion[]; // typically 2-4
  commonGround: string; // one sentence all groups share
};
