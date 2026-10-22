// Error classification and rendering — the single place where low-level
// failures (dead daemon, network, disk) become actionable messages. The rules:
// translate only what we can recognize, never dress up unknowns as understood,
// and always leave a path forward (fix command, resume hint, WT_DEBUG).
//
// Curated errors thrown by our own code embed their remedy after an em-dash
// ("no persona pool installed — run: …") and pass through untouched.

import { CuratedError, type ModelProvider } from "@wind-tunnel/core";
import { version } from "../package.json";
import { painter, useColor } from "./render/format";

const ISSUES_URL = "https://github.com/7omoo/wind-tunnel-cli/issues";

type ErrorKind =
  | "connection"
  | "network"
  | "timeout"
  | "disk"
  | "permission"
  | "curated"
  | "unknown";

export type ClassifiedError = {
  kind: ErrorKind;
  headline: string;
  hints: string[];
};

// What the error happened under. providers = the run's model providers; when
// unknown (errors outside a run) the default provider, Ollama, is assumed.
export type ErrorContext = { providers?: readonly ModelProvider[] };

// The local model servers a run can depend on, and how to bring each back:
// `start` after a refused connection, `inspect` + `restart` after a timeout
// (usually a wedged model load). Gemini has no server to manage; for it the
// resume hint is all there is.
type LocalServer = {
  name: string;
  start: string;
  restart: string;
  install: string;
  inspect: readonly string[];
};

const LOCAL_SERVERS: Record<"ollama" | "lmstudio", LocalServer> = {
  ollama: {
    name: "Ollama",
    start: "brew services start ollama (or: ollama serve)",
    restart: "brew services restart ollama (or restart the Ollama app)",
    install: "https://ollama.com/download",
    inspect: [],
  },
  lmstudio: {
    name: "LM Studio",
    start: "lms server start (or the Developer tab in the app)",
    restart: "lms server stop && lms server start (or restart the LM Studio app)",
    install: "https://lmstudio.ai",
    inspect: ["check what's loaded: lms ps"],
  },
};

function localServers(providers: readonly ModelProvider[]): LocalServer[] {
  return (["ollama", "lmstudio"] as const)
    .filter((p) => providers.includes(p))
    .map((p) => LOCAL_SERVERS[p]);
}

function connectionError(providers: readonly ModelProvider[]): ClassifiedError {
  const servers = localServers(providers);
  if (servers.length === 0) {
    return {
      kind: "connection",
      headline: "could not reach the model server",
      hints: ["check your network connection and retry"],
    };
  }
  return {
    kind: "connection",
    headline: `${servers.map((s) => s.name).join(" or ")} stopped responding`,
    hints: servers.flatMap((s) => [`start it again: ${s.start}`, `not installed? ${s.install}`]),
  };
}

function timeoutError(providers: readonly ModelProvider[]): ClassifiedError {
  const servers = localServers(providers);
  if (servers.length === 0) {
    return { kind: "timeout", headline: "an LLM call timed out", hints: [] };
  }
  return {
    kind: "timeout",
    headline: `an LLM call timed out — ${servers.map((s) => s.name).join(" or ")} looks stuck (often a wedged model load)`,
    hints: [
      "check what's loaded: wt-cli doctor",
      ...servers.flatMap((s) => [...s.inspect, `restart the server: ${s.restart}`]),
    ],
  };
}

// Flatten an error and its cause chain (plus AggregateError members) into one
// searchable text, keeping the top-level message for display.
function collectText(e: unknown, depth = 0): string {
  if (depth > 6 || e == null) return "";
  const parts: string[] = [];
  if (e instanceof Error) {
    parts.push(`${e.name}: ${e.message}`);
    if ("code" in e && typeof (e as NodeJS.ErrnoException).code === "string") {
      parts.push(String((e as NodeJS.ErrnoException).code));
    }
    if (e instanceof AggregateError) {
      for (const inner of e.errors) parts.push(collectText(inner, depth + 1));
    }
    if (e.cause) parts.push(collectText(e.cause, depth + 1));
  } else {
    parts.push(String(e));
  }
  return parts.join(" | ");
}

export function classifyError(e: unknown, context: ErrorContext = {}): ClassifiedError {
  const message = e instanceof Error ? e.message : String(e);
  const text = collectText(e);

  // Our own curated errors carry their remedy inline.
  if (e instanceof CuratedError) {
    return { kind: "curated", headline: message, hints: [] };
  }

  // Hugging Face / ingest network problems (DuckDB httpfs wording) — checked
  // before the generic connection class, which would otherwise swallow them.
  if (/hf:\/\/|huggingface|HTTP GET error|HTTP Error/i.test(text)) {
    return {
      kind: "network",
      headline: "could not reach Hugging Face to stream the dataset",
      hints: [
        "check your network connection and retry — pulls are resumable from scratch (the pool is only swapped on success)",
      ],
    };
  }

  if (/TimeoutError|operation was aborted|timed out/i.test(text)) {
    return timeoutError(context.providers ?? ["ollama"]);
  }

  if (
    /ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|socket hang up|fetch failed|other side closed|UND_ERR|Connect Timeout/i.test(
      text,
    )
  ) {
    return connectionError(context.providers ?? ["ollama"]);
  }

  if (/ENOSPC/.test(text)) {
    return {
      kind: "disk",
      headline: "the disk is full",
      hints: ["free some space — pools and runs live under ~/.local/share/wind-tunnel"],
    };
  }
  if (/EACCES|EPERM/.test(text)) {
    return {
      kind: "permission",
      headline: `permission denied: ${message}`,
      hints: ["check ownership of ~/.local/share/wind-tunnel and ~/.config/wind-tunnel"],
    };
  }

  return { kind: "unknown", headline: message, hints: [] };
}

export function renderError(
  e: unknown,
  stream: NodeJS.WriteStream = process.stderr,
  opts: { resumeId?: string } & ErrorContext = {},
): void {
  const c = painter(useColor(stream));
  const classified = classifyError(e, opts);

  stream.write(`${c("red", "✗")} ${classified.headline}\n`);
  for (const hint of classified.hints) {
    stream.write(c("dim", `  ${hint}\n`));
  }
  if (opts.resumeId && classified.kind !== "curated") {
    stream.write(
      c("dim", `  the run is checkpointed — continue with: wt-cli resume ${opts.resumeId}\n`),
    );
  }
  if (classified.kind === "unknown") {
    stream.write(c("dim", `  more detail: WT_DEBUG=1 · report: ${ISSUES_URL}\n`));
  }

  if (process.env.WT_DEBUG) {
    stream.write(
      c(
        "dim",
        `\n[debug] wind-tunnel ${version} · node ${process.version} · ${process.platform}-${process.arch}\n`,
      ),
    );
    let current: unknown = e;
    let depth = 0;
    while (current instanceof Error && depth < 6) {
      stream.write(c("dim", `${current.stack ?? `${current.name}: ${current.message}`}\n`));
      if (current instanceof AggregateError && current.errors.length > 0) {
        stream.write(
          c("dim", `[debug] aggregate of ${current.errors.length} errors; first follows\n`),
        );
        current = current.errors[0];
      } else {
        current = current.cause;
      }
      if (current) stream.write(c("dim", "[debug] caused by:\n"));
      depth++;
    }
  }
}
