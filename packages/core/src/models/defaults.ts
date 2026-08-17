// Model roles. Almost the entire pipeline rides on `bulk` (~112 calls at N=100);
// only a handful of calls need `analysis`/`premium`. That ratio is what makes
// full-local viable — keep bulk small and fast.

export type ModelRole = "bulk" | "analysis" | "premium";

// "provider:model" spec per role.
export type ModelRoles = Record<ModelRole, string>;

// Defaults for the local profile. Subject to a local eval pass (docs/DESIGN.md §13);
// override via config.toml / flags.
export const DEFAULT_MODEL_ROLES: ModelRoles = {
  bulk: "ollama:qwen3:8b",
  analysis: "ollama:qwen3:14b",
  premium: "ollama:qwen3:14b",
};
