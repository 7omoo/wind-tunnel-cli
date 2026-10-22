// @wind-tunnel/core — persona reaction pipeline.
//
// The engine's public surface: wider than what the CLI consumes, since this
// is the API a standalone publish of the package would expose. Exports stay
// explicit (no wildcard barrels) and sorted by module path — Biome's
// organizeImports keeps that order, which is why there are no section
// headers here.
export {
  computeBridging,
  detectConsensus,
  detectDivision,
  isConsensus,
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
export { COUNTRY_CODES, COUNTRY_LABELS, COUNTRY_TO_REGIONS } from "./data/countries";
export { PERSONA_LANG_CODES, PERSONA_LANGUAGES } from "./data/languages";
export type { RegionOption } from "./data/regions";
export {
  DEFAULT_SITUATION,
  type LengthPolicy,
  SITUATIONS,
  type SituationMeta,
} from "./data/situations";
export {
  DEFAULT_LMSTUDIO_URL,
  getLmStudioLoadedContext,
  listLmStudioModels,
} from "./lmstudio/client";
export {
  diagnoseLmStudio,
  LMSTUDIO_MIN_CONTEXT,
  type LmStudioDoctorReport,
  type LmStudioRoleCheck,
  loadCommand,
  needsLargerContext,
} from "./lmstudio/doctor";
export { DEFAULT_MODEL_ROLES, type ModelRole, type ModelRoles } from "./models/defaults";
export { createPipelineModels, type PipelineModels } from "./models/pipeline";
export {
  type ModelProvider,
  type ParsedModelSpec,
  type ProviderSettings,
  parseModelSpec,
  resolveModel,
} from "./models/registry";
export { DEFAULT_KEEP_ALIVE, type PipelineStage, STAGE_NUM_CTX } from "./models/stages";
export {
  DEFAULT_OLLAMA_URL,
  getOllamaVersion,
  type InstalledModel,
  isModelInstalled,
  listInstalledModels,
  listRunningModels,
  type RunningModel,
} from "./ollama/client";
export { diagnoseOllama, type OllamaDoctorReport, type RoleCheck } from "./ollama/doctor";
export {
  type IngestProgress,
  type IngestResult,
  pullCountryPool,
} from "./personas/ingest";
export { createJsonPersonaSource, loadJsonPersonaSource } from "./personas/json-source";
export { extractName } from "./personas/names";
export {
  defaultPoolPath,
  openPersonaPool,
  type PersonaPool,
  type PoolInfo,
  poolExists,
} from "./personas/pool";
export { COUNTRY_PRESETS, type CountryPreset } from "./personas/presets";
export type { PersonaFilter, PersonaSource } from "./personas/source";
export { analyzeVerdict, SCORE_BATCH_SIZE, scoreOpinions } from "./pipeline/analyze";
export { chunk, mapWaves } from "./pipeline/batch";
export { clusterOpinions } from "./pipeline/cluster";
export { STANCE_BATCH_SIZE } from "./pipeline/cluster-stages";
export { type ReactOptions, type ReactSummary, reactPersonas } from "./pipeline/react";
export { type ScoredOpinion, stratifiedSample } from "./pipeline/sample";
export { suggestAlternatives } from "./pipeline/suggest";
export {
  buildContextBlock,
  buildPersonaSystemPrompt,
  getPrompt,
  getSystemExtra,
} from "./prompts/persona";
export { getSituationFraming, lengthClause } from "./prompts/situation";
export { type ExecuteDeps, executeRun } from "./run/execute";
export { configRoot, dataRoot, isRunId, newRunId, runsRoot } from "./run/paths";
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
export {
  CONTEXT_MAX_CHARS,
  countrySchema,
  defaultOutputLang,
  defaultPersonaLang,
  outputLangName,
  outputLangSchema,
  personaLangSchema,
  riskLevelSchema,
  severitySchema,
  situationSchema,
  topicSchema,
} from "./schemas";
export type {
  AlternativeSuggestion,
  AlternativeSuggestions,
  Country,
  FlameResult,
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
  Severity,
  Situation,
  Trigger,
} from "./types";
export { opinionsToCsv } from "./util/csv";
export { CuratedError } from "./util/curated-error";
export { clampPromptInput, escapeForPrompt, quoteUntrusted } from "./util/sanitize";
export { shuffle } from "./util/shuffle";
