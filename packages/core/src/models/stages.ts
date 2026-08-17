// Per-stage context budgets for local models.
//
// Why this exists: Ollama sizes a KV-cache slot per parallel request at num_ctx,
// so the react stage keeps a small window (that's what allows high parallelism)
// while the whole-corpus stages get a large one and run single-slot. The design
// table lives in docs/DESIGN.md §4; this module is its executable form.

export type PipelineStage =
  | "react"
  | "score"
  | "stance"
  | "axis_labels"
  | "verdict"
  | "propositions"
  | "profiles"
  | "suggest";

export const STAGE_NUM_CTX: Record<PipelineStage, number> = {
  react: 4096,
  score: 8192,
  stance: 8192,
  axis_labels: 8192,
  verdict: 32768,
  propositions: 32768,
  profiles: 32768,
  suggest: 16384,
};

// Keep models resident between stages so a run never pays reload latency
// mid-pipeline. Ollama's default (5m) can evict between slow stages.
export const DEFAULT_KEEP_ALIVE = "15m";
