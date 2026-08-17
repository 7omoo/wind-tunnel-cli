// Thin HTTP probes against the Ollama daemon API. Used by doctor and by
// preflight checks before a run. Deliberately plain fetch — no SDK dependency,
// defensive parsing (fields differ across daemon versions).

export const DEFAULT_OLLAMA_URL = "http://localhost:11434";

const PROBE_TIMEOUT_MS = 2500;

function url(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

// Daemon version, or null when unreachable. This is the reachability probe:
// callers treat null as "daemon down" and skip the other calls.
export async function getOllamaVersion(baseUrl = DEFAULT_OLLAMA_URL): Promise<string | null> {
  try {
    const res = await fetch(url(baseUrl, "/api/version"), {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: unknown };
    return typeof body.version === "string" ? body.version : null;
  } catch {
    return null;
  }
}

export type InstalledModel = {
  name: string;
  sizeBytes: number;
  parameterSize?: string; // e.g. "8.2B"
  quantization?: string; // e.g. "Q4_K_M"
};

// GET /api/tags — models present on disk.
export async function listInstalledModels(baseUrl = DEFAULT_OLLAMA_URL): Promise<InstalledModel[]> {
  const res = await fetch(url(baseUrl, "/api/tags"), {
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`GET /api/tags failed: ${res.status}`);
  const body = (await res.json()) as {
    models?: {
      name?: string;
      size?: number;
      details?: { parameter_size?: string; quantization_level?: string };
    }[];
  };
  return (body.models ?? [])
    .filter((m): m is typeof m & { name: string } => typeof m.name === "string")
    .map((m) => ({
      name: m.name,
      sizeBytes: typeof m.size === "number" ? m.size : 0,
      parameterSize: m.details?.parameter_size,
      quantization: m.details?.quantization_level,
    }));
}

export type RunningModel = {
  name: string;
  sizeVramBytes?: number;
  // Per-slot context length. Present on recent daemons; useful to verify that a
  // requested num_ctx actually reached the daemon.
  contextLength?: number;
  expiresAt?: string;
};

// GET /api/ps — models currently loaded in memory.
export async function listRunningModels(baseUrl = DEFAULT_OLLAMA_URL): Promise<RunningModel[]> {
  const res = await fetch(url(baseUrl, "/api/ps"), {
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`GET /api/ps failed: ${res.status}`);
  const body = (await res.json()) as {
    models?: {
      name?: string;
      size_vram?: number;
      context_length?: number;
      expires_at?: string;
    }[];
  };
  return (body.models ?? [])
    .filter((m): m is typeof m & { name: string } => typeof m.name === "string")
    .map((m) => ({
      name: m.name,
      sizeVramBytes: typeof m.size_vram === "number" ? m.size_vram : undefined,
      contextLength: typeof m.context_length === "number" ? m.context_length : undefined,
      expiresAt: typeof m.expires_at === "string" ? m.expires_at : undefined,
    }));
}

// Does the installed-model list contain this name? "qwen3" also matches
// "qwen3:latest" (Ollama's implicit default tag).
export function isModelInstalled(installed: InstalledModel[], name: string): boolean {
  return installed.some((m) => m.name === name || m.name === `${name}:latest`);
}
