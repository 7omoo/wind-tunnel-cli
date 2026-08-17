// @wind-tunnel/core — persona reaction pipeline.
// Public surface grows as modules land; exports stay explicit (no wildcard barrels).

// Analysis (pure math)
export {
  computeBridging,
  detectConsensus,
  detectDivision,
  silhouette,
} from "./analysis/clustering";
export {
  averageScore,
  bucketScores,
  classifySentiment,
  percentages,
  type ScoreLike,
  SENTIMENT_THRESHOLD,
  type Sentiment,
  type SentimentCounts,
  sentimentCounts,
} from "./analysis/scoring";

// Static data
export { COUNTRY_CODES, COUNTRY_LABELS, COUNTRY_TO_REGIONS } from "./data/countries";
export { PERSONA_LANG_CODES, PERSONA_LANGUAGES } from "./data/languages";
export type { RegionOption } from "./data/regions";
export {
  DEFAULT_SITUATION,
  type LengthPolicy,
  SITUATION_CODES,
  SITUATIONS,
  type SituationMeta,
} from "./data/situations";
// Models
export { DEFAULT_MODEL_ROLES, type ModelRole, type ModelRoles } from "./models/defaults";
export { createPipelineModels, type PipelineModels } from "./models/pipeline";
export {
  DEFAULT_OLLAMA_URL,
  type ModelProvider,
  type ParsedModelSpec,
  type ProviderSettings,
  parseModelSpec,
  resolveModel,
} from "./models/registry";
export { DEFAULT_KEEP_ALIVE, type PipelineStage, STAGE_NUM_CTX } from "./models/stages";

// Ollama daemon probes & diagnosis
export {
  getOllamaVersion,
  type InstalledModel,
  isModelInstalled,
  listInstalledModels,
  listRunningModels,
  type RunningModel,
} from "./ollama/client";
export { diagnoseOllama, type OllamaDoctorReport, type RoleCheck } from "./ollama/doctor";
export { createJsonPersonaSource, loadJsonPersonaSource } from "./personas/json-source";
// Personas
export { extractName } from "./personas/names";
export type { PersonaFilter, PersonaSource } from "./personas/source";

// Pipeline stages
export { analyzeVerdict, SCORE_BATCH_SIZE, scoreOpinions } from "./pipeline/analyze";
export { chunk, mapWaves } from "./pipeline/batch";
export { clusterOpinions } from "./pipeline/cluster";
export { STANCE_BATCH_SIZE } from "./pipeline/cluster-stages";
export { type ReactOptions, type ReactSummary, reactPersonas } from "./pipeline/react";
export { type ScoredOpinion, stratifiedSample } from "./pipeline/sample";
export { suggestAlternatives } from "./pipeline/suggest";
// Prompts
export {
  buildContextBlock,
  buildPersonaSystemPrompt,
  getPrompt,
  getSystemExtra,
} from "./prompts/persona";
export { getSituationFraming, lengthClause } from "./prompts/situation";
// Run store & executor
export { type ExecuteDeps, executeRun } from "./run/execute";
export { configRoot, dataRoot, newRunId, runsRoot } from "./run/paths";
export { RunStore } from "./run/store";
export type {
  AnalyzeArtifact,
  ClusterArtifact,
  PersonasArtifact,
  RunInput,
  RunProgressEvent,
  RunStageName,
  RunStatus,
  RunSummary,
  ScoresArtifact,
  SuggestArtifact,
} from "./run/types";
// Schemas & enums
export {
  alternativeSuggestionSchema,
  alternativeSuggestionsSchema,
  CONTEXT_MAX_CHARS,
  countrySchema,
  defaultPersonaLang,
  flameResultSchema,
  groupProfileSchema,
  llmOpinionScoreSchema,
  llmTriggerSchema,
  minorityReportSchema,
  normalizeOutputLang,
  outputLangName,
  outputLangSchema,
  personaLangSchema,
  propositionsSchema,
  riskLevelSchema,
  situationSchema,
  topicSchema,
} from "./schemas";
// Domain types
export type {
  AlternativeSuggestion,
  AlternativeSuggestions,
  Country,
  FlameResult,
  FlameResultCore,
  FlameResultExtras,
  Opinion,
  OpinionAxis,
  OpinionCluster,
  OpinionClusterBridging,
  OpinionClusterConsensus,
  OpinionClusterDivisive,
  OpinionClusterGroupProfile,
  OpinionClusterMinorityReport,
  OpinionClusterProposition,
  OpinionClusterResult,
  OpinionScore,
  OutputLang,
  PersonaLang,
  PlotPoint,
  RawPersona,
  RiskLevel,
  Situation,
  Trigger,
} from "./types";

// Utilities
export { opinionsToCsv, safeFilename } from "./util/csv";
export { parseLLMJson, parseLLMJsonChecked } from "./util/llm-json";
export { escapeForPrompt, sanitizePromptInput } from "./util/sanitize";
export { shuffle } from "./util/shuffle";
