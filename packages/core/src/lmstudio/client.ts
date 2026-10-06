// Thin HTTP probe against the LM Studio local server. Used by doctor and by
// preflight checks before a run. Plain fetch, like ollama/client.ts.

export const DEFAULT_LMSTUDIO_URL = "http://localhost:1234";

const PROBE_TIMEOUT_MS = 2500;

// Model ids the server can serve, or null when it is unreachable. GET /v1/models
// lists the downloaded models (LM Studio loads one on its first request), so an
// id missing here means the model needs `lms get` first.
export async function listLmStudioModels(baseUrl = DEFAULT_LMSTUDIO_URL): Promise<string[] | null> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/models`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: { id?: unknown }[] };
    return (body.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === "string");
  } catch {
    return null;
  }
}

// Context length the model is currently loaded with, or null when it is not
// loaded (or the server is unreachable). LM Studio fixes context at load time —
// a model loaded on first request gets the app default, often 4096 — so this is
// what bounds every prompt sent to it. Uses LM Studio's own /api/v0 endpoint;
// the OpenAI-compatible /v1 API does not report it.
export async function getLmStudioLoadedContext(
  model: string,
  baseUrl = DEFAULT_LMSTUDIO_URL,
): Promise<number | null> {
  try {
    const res = await fetch(
      `${baseUrl.replace(/\/$/, "")}/api/v0/models/${encodeURIComponent(model)}`,
      { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { state?: unknown; loaded_context_length?: unknown };
    if (body.state !== "loaded") return null;
    return typeof body.loaded_context_length === "number" ? body.loaded_context_length : null;
  } catch {
    return null;
  }
}
