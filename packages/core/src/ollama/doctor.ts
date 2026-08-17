// Environment diagnosis for the Ollama side of a run. Returns structured data;
// rendering (and exit codes) belong to the CLI.
//
// Note: OLLAMA_NUM_PARALLEL / OLLAMA_MAX_LOADED_MODELS are daemon-side settings
// that the HTTP API does not expose, so effective parallelism cannot be read
// here — the CLI states the defaults and how to change them, and the run stage
// detects saturation empirically.

import type { ModelRoles } from "../models/defaults";
import { parseModelSpec } from "../models/registry";
import {
  DEFAULT_OLLAMA_URL,
  getOllamaVersion,
  type InstalledModel,
  isModelInstalled,
  listInstalledModels,
  listRunningModels,
  type RunningModel,
} from "./client";

export type RoleCheck = {
  role: string;
  spec: string;
  // "ollama" role models can be verified against /api/tags; cloud providers
  // can't be checked from here -> installed: null.
  provider: "ollama" | "gemini";
  installed: boolean | null;
  // `ollama pull` argument when missing (ollama provider only).
  pullName?: string;
};

export type OllamaDoctorReport = {
  baseUrl: string;
  reachable: boolean;
  version: string | null;
  installed: InstalledModel[];
  running: RunningModel[];
  roleChecks: RoleCheck[];
};

export async function diagnoseOllama(opts: {
  baseUrl?: string;
  roles?: ModelRoles;
}): Promise<OllamaDoctorReport> {
  const baseUrl = opts.baseUrl ?? DEFAULT_OLLAMA_URL;
  const version = await getOllamaVersion(baseUrl);
  if (version === null) {
    return {
      baseUrl,
      reachable: false,
      version: null,
      installed: [],
      running: [],
      roleChecks: roleChecksFor(opts.roles, []),
    };
  }
  // Probes can still fail individually (daemon restarting); degrade per call.
  const installed = await listInstalledModels(baseUrl).catch(() => [] as InstalledModel[]);
  const running = await listRunningModels(baseUrl).catch(() => [] as RunningModel[]);
  return {
    baseUrl,
    reachable: true,
    version,
    installed,
    running,
    roleChecks: roleChecksFor(opts.roles, installed),
  };
}

function roleChecksFor(roles: ModelRoles | undefined, installed: InstalledModel[]): RoleCheck[] {
  if (!roles) return [];
  return Object.entries(roles).map(([role, spec]) => {
    const parsed = parseModelSpec(spec);
    if (parsed.provider !== "ollama") {
      return { role, spec, provider: parsed.provider, installed: null };
    }
    return {
      role,
      spec,
      provider: "ollama",
      installed: isModelInstalled(installed, parsed.name),
      pullName: parsed.name,
    };
  });
}
