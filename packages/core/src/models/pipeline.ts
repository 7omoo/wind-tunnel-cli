// Stage-aware model accessors for the pipeline. Built once per run:
// probes each unique Ollama model's capabilities so that thinking models run
// with thinking OFF (throughput — the react stage alone is ~100 calls), while
// models without the capability never receive the parameter (the daemon
// rejects it on them).

import type { LanguageModel } from "ai";
import { getModelCapabilities } from "../ollama/client";
import type { ModelRole, ModelRoles } from "./defaults";
import {
  DEFAULT_OLLAMA_URL,
  type ProviderSettings,
  parseModelSpec,
  resolveModel,
} from "./registry";
import type { PipelineStage } from "./stages";

export type PipelineModels = {
  role(role: ModelRole, stage: PipelineStage): LanguageModel;
};

export async function createPipelineModels(
  roles: ModelRoles,
  settings: ProviderSettings = {},
): Promise<PipelineModels> {
  // Detect thinking capability once per unique Ollama model. Probe failures
  // (daemon briefly down, unknown model) degrade to "don't send the parameter".
  const thinkFlags = new Map<string, boolean>();
  const ollamaNames = new Set(
    Object.values(roles)
      .map((spec) => parseModelSpec(spec))
      .filter((p) => p.provider === "ollama")
      .map((p) => p.name),
  );
  const baseUrl = settings.ollamaBaseUrl ?? DEFAULT_OLLAMA_URL;
  await Promise.all(
    [...ollamaNames].map(async (name) => {
      const caps = await getModelCapabilities(name, baseUrl);
      if (caps?.includes("thinking")) thinkFlags.set(name, false);
    }),
  );

  return {
    role(role: ModelRole, stage: PipelineStage): LanguageModel {
      const spec = roles[role];
      const parsed = parseModelSpec(spec);
      const think = parsed.provider === "ollama" ? thinkFlags.get(parsed.name) : undefined;
      return resolveModel(spec, settings, { stage, think });
    },
  };
}
