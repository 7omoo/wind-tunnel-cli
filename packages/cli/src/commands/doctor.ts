// `wt-cli doctor` — diagnose the local environment: Ollama reachability,
// role models present, what's loaded right now. Prints the exact fix command
// for anything missing. Exit 1 when the local profile could not run as-is.

import {
  DEFAULT_MODEL_ROLES,
  DEFAULT_OLLAMA_URL,
  diagnoseOllama,
  type OllamaDoctorReport,
} from "@wind-tunnel/core";

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${bytes} B`;
}

export function resolveOllamaBaseUrl(flagHost?: string): string {
  // Precedence: --host flag > OLLAMA_HOST env (Ollama CLI convention) > default.
  if (flagHost) return flagHost;
  const env = process.env.OLLAMA_HOST;
  if (env) return env.startsWith("http") ? env : `http://${env}`;
  return DEFAULT_OLLAMA_URL;
}

export function renderDoctorReport(report: OllamaDoctorReport): { text: string; ok: boolean } {
  const lines: string[] = [];
  let ok = true;

  lines.push(`Ollama    ${report.baseUrl}`);
  if (!report.reachable) {
    ok = false;
    lines.push("  ✗ daemon not reachable");
    lines.push("");
    lines.push("  Start it with one of:");
    lines.push("    brew services start ollama        # managed, restarts on login");
    lines.push("    ollama serve                      # foreground");
    lines.push("");
    lines.push("  To raise parallelism for reaction batches (daemon-side setting):");
    lines.push("    OLLAMA_NUM_PARALLEL=8 ollama serve");
    return { text: lines.join("\n"), ok };
  }

  lines.push(`  ✓ daemon reachable (version ${report.version})`);
  lines.push("");
  lines.push("  Role models:");
  for (const check of report.roleChecks) {
    const pad = check.role.padEnd(9);
    if (check.installed === null) {
      lines.push(`  - ${pad} ${check.spec}  (cloud — checked at run time)`);
      continue;
    }
    if (check.installed) {
      const size = report.installed.find(
        (m) => m.name === check.pullName || m.name === `${check.pullName}:latest`,
      )?.sizeBytes;
      lines.push(`  ✓ ${pad} ${check.spec}${size ? `  (${formatBytes(size)})` : ""}`);
    } else {
      ok = false;
      lines.push(`  ✗ ${pad} ${check.spec}  missing — run: ollama pull ${check.pullName}`);
    }
  }

  if (report.running.length > 0) {
    lines.push("");
    lines.push("  Loaded now:");
    for (const m of report.running) {
      const ctx = m.contextLength ? `  ctx ${m.contextLength}` : "";
      const vram = m.sizeVramBytes ? `  ${formatBytes(m.sizeVramBytes)}` : "";
      lines.push(`  • ${m.name}${vram}${ctx}`);
    }
  }

  lines.push("");
  lines.push("  Note: reaction-batch parallelism is capped by the daemon-side");
  lines.push("  OLLAMA_NUM_PARALLEL (default 4 with GPU, 1 CPU-only; not readable");
  lines.push("  over the API). To raise it: OLLAMA_NUM_PARALLEL=8 ollama serve");

  return { text: lines.join("\n"), ok };
}

export async function runDoctor(opts: { host?: string }): Promise<number> {
  const baseUrl = resolveOllamaBaseUrl(opts.host);
  const report = await diagnoseOllama({ baseUrl, roles: DEFAULT_MODEL_ROLES });
  const { text, ok } = renderDoctorReport(report);
  console.log(text);
  return ok ? 0 : 1;
}
