// Model resolution: "provider:model" spec -> AI SDK model instance.
//
// Ollama goes through the native provider (ai-sdk-ollama), NOT the
// OpenAI-compatible endpoint, for two documented reasons (docs/DESIGN.md §5):
//   - num_ctx must be set per request; the compat endpoint silently truncates
//     at the daemon default instead of erroring.
//   - constrained decoding (`format`) only works natively; the compat path
//     ignores response_format json_schema. Structured output via the AI SDK's
//     Output.object() maps onto it automatically.
//
// LM Studio has no native AI SDK provider; its OpenAI-compatible endpoint does
// enforce response_format json_schema, so it goes through @ai-sdk/openai-compatible
// with structured outputs on. Context length is fixed when the model is loaded
// in LM Studio, not per request.
//
// Unknown providers fail loudly — a CLI should never silently fall back to a
// different (possibly metered) provider.

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { type LanguageModel, wrapLanguageModel } from "ai";
import { createOllama } from "ai-sdk-ollama";
import { DEFAULT_LMSTUDIO_URL } from "../lmstudio/client";
import { reasoningAsJsonTextMiddleware } from "../lmstudio/reasoning-workaround";
import { retryUnenforcedJsonMiddleware } from "../lmstudio/structured-output-retry";
import { DEFAULT_OLLAMA_URL } from "../ollama/client";
import { CuratedError } from "../util/curated-error";
import { DEFAULT_KEEP_ALIVE, type PipelineStage, STAGE_NUM_CTX } from "./stages";

export type ModelProvider = "ollama" | "lmstudio" | "gemini";

export type ParsedModelSpec = { provider: ModelProvider; name: string };

// Split on the FIRST colon only — Ollama model names contain colons themselves
// ("ollama:qwen3:8b" -> provider "ollama", name "qwen3:8b").
export function parseModelSpec(spec: string): ParsedModelSpec {
  const i = spec.indexOf(":");
  const provider = i === -1 ? "" : spec.slice(0, i);
  const name = i === -1 ? "" : spec.slice(i + 1);
  if (!provider || !name) {
    throw new CuratedError(
      `invalid model spec "${spec}" — expected "provider:model", e.g. "ollama:qwen3:8b"`,
    );
  }
  if (provider === "ollama") return { provider: "ollama", name };
  if (provider === "lmstudio") return { provider: "lmstudio", name };
  if (provider === "gemini" || provider === "google") return { provider: "gemini", name };
  throw new CuratedError(
    `unknown model provider "${provider}" in "${spec}" — one of: ollama, lmstudio, gemini`,
  );
}

export type ProviderSettings = {
  // Ollama daemon base URL. Defaults to the local daemon.
  ollamaBaseUrl?: string;
  // LM Studio server base URL (without /v1). Defaults to the local server.
  lmstudioBaseUrl?: string;
  // Gemini API key (hybrid profile). Only required when a gemini: spec is resolved.
  geminiApiKey?: string;
};

// Provider instances are cached per connection target (base URL or API key);
// model instances are cheap and constructed per call site, since they carry
// per-stage settings.
function cached<T>(create: (key: string) => T): (key: string) => T {
  const instances = new Map<string, T>();
  return (key) => {
    let instance = instances.get(key);
    if (!instance) {
      instance = create(key);
      instances.set(key, instance);
    }
    return instance;
  };
}

const ollamaProvider = cached((baseUrl) => createOllama({ baseURL: baseUrl }));
const lmstudioProvider = cached((baseUrl) =>
  createOpenAICompatible({
    name: "lmstudio",
    baseURL: `${baseUrl.replace(/\/$/, "")}/v1`,
    supportsStructuredOutputs: true,
  }),
);
const geminiProvider = cached((apiKey) => createGoogleGenerativeAI({ apiKey }));

export type ResolveModelOptions = {
  // Pipeline stage; selects the num_ctx budget for Ollama models (STAGE_NUM_CTX).
  // Ignored for cloud providers, which manage context server-side.
  stage?: PipelineStage;
  // Thinking-mode control for Ollama models. Only pass a value for models whose
  // /api/show capabilities include "thinking" — the daemon rejects the parameter
  // on models that don't support it. createPipelineModels handles the detection;
  // the pipeline runs with thinking off for throughput.
  think?: boolean;
};

export function resolveModel(
  spec: string,
  settings: ProviderSettings = {},
  opts: ResolveModelOptions = {},
): LanguageModel {
  const parsed = parseModelSpec(spec);
  if (parsed.provider === "ollama") {
    const baseUrl = settings.ollamaBaseUrl ?? DEFAULT_OLLAMA_URL;
    return ollamaProvider(baseUrl)(parsed.name, {
      keep_alive: DEFAULT_KEEP_ALIVE,
      ...(opts.think !== undefined ? { think: opts.think } : {}),
      ...(opts.stage ? { options: { num_ctx: STAGE_NUM_CTX[opts.stage] } } : {}),
    });
  }
  if (parsed.provider === "lmstudio") {
    const baseUrl = settings.lmstudioBaseUrl ?? DEFAULT_LMSTUDIO_URL;
    return wrapLanguageModel({
      model: lmstudioProvider(baseUrl)(parsed.name),
      // Outer first: the retry judges the answer after reasoning recovery.
      middleware: [retryUnenforcedJsonMiddleware, reasoningAsJsonTextMiddleware],
    });
  }
  // gemini
  const apiKey = settings.geminiApiKey;
  if (!apiKey) {
    throw new CuratedError(
      `model "${spec}" needs a Gemini API key — set GEMINI_API_KEY or [model] gemini_api_key in config.toml`,
    );
  }
  return geminiProvider(apiKey)(parsed.name);
}
