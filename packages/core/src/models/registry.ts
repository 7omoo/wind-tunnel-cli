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
// Unknown providers fail loudly — a CLI should never silently fall back to a
// different (possibly metered) provider.

import { createGoogleGenerativeAI, type GoogleGenerativeAIProvider } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import { createOllama, type OllamaProvider } from "ai-sdk-ollama";
import { DEFAULT_KEEP_ALIVE, type PipelineStage, STAGE_NUM_CTX } from "./stages";

export type ModelProvider = "ollama" | "gemini";

export type ParsedModelSpec = { provider: ModelProvider; name: string };

// Split on the FIRST colon only — Ollama model names contain colons themselves
// ("ollama:qwen3:8b" -> provider "ollama", name "qwen3:8b").
export function parseModelSpec(spec: string): ParsedModelSpec {
  const i = spec.indexOf(":");
  const provider = i === -1 ? "" : spec.slice(0, i);
  const name = i === -1 ? "" : spec.slice(i + 1);
  if (!provider || !name) {
    throw new Error(
      `Invalid model spec "${spec}" — expected "provider:model", e.g. "ollama:qwen3:8b"`,
    );
  }
  if (provider === "ollama") return { provider: "ollama", name };
  if (provider === "gemini" || provider === "google") return { provider: "gemini", name };
  throw new Error(`Unknown model provider "${provider}" in "${spec}" (supported: ollama, gemini)`);
}

export const DEFAULT_OLLAMA_URL = "http://localhost:11434";

export type ProviderSettings = {
  // Ollama daemon base URL. Defaults to the local daemon.
  ollamaBaseUrl?: string;
  // Gemini API key (hybrid profile). Only required when a gemini: spec is resolved.
  geminiApiKey?: string;
};

// Provider instances are cached per connection target; model instances are
// cheap and constructed per call site (they carry per-stage settings).
const ollamaProviders = new Map<string, OllamaProvider>();
function ollamaProvider(baseUrl: string): OllamaProvider {
  let p = ollamaProviders.get(baseUrl);
  if (!p) {
    p = createOllama({ baseURL: baseUrl });
    ollamaProviders.set(baseUrl, p);
  }
  return p;
}

const geminiProviders = new Map<string, GoogleGenerativeAIProvider>();
function geminiProvider(apiKey: string): GoogleGenerativeAIProvider {
  let p = geminiProviders.get(apiKey);
  if (!p) {
    p = createGoogleGenerativeAI({ apiKey });
    geminiProviders.set(apiKey, p);
  }
  return p;
}

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
  // gemini
  const apiKey = settings.geminiApiKey;
  if (!apiKey) {
    throw new Error(
      `Model "${spec}" needs a Gemini API key (set GEMINI_API_KEY or [model] gemini_api_key in config)`,
    );
  }
  return geminiProvider(apiKey)(parsed.name);
}
