// `wt-cli doctor` — diagnose the local environment: Ollama reachability,
// role models present, what's loaded right now. Prints the exact fix command
// for anything missing. Exit 1 when the local profile could not run as-is.

import {
  DEFAULT_OLLAMA_URL,
  diagnoseOllama,
  type ModelRoles,
  type OllamaDoctorReport,
} from "@wind-tunnel/core";
import { type CliFlags, loadConfig, type ResolvedConfig } from "../config";

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${bytes} B`;
}

// What to diagnose: the host and role models `run` would use, taken from the
// same resolved config (flags > WT_* env > config.toml > defaults), so a pass
// here means the real run sees the same daemon and models.
export function doctorTarget(cfg: ResolvedConfig): { baseUrl: string; roles: ModelRoles } {
  return { baseUrl: cfg.ollamaHost ?? DEFAULT_OLLAMA_URL, roles: cfg.models };
}

export function renderDoctorReport(report: OllamaDoctorReport): { text: string; ok: boolean } {
  const lines: string[] = [];
  let ok = true;

  lines.push(`Ollama    ${report.baseUrl}`);
  if (!report.reachable) {
    ok = false;
    lines.push("  ✗ daemon not reachable");
    lines.push("");
    lines.push("  Not installed?  https://ollama.com/download  (macOS: brew install ollama)");
    lines.push("  Installed — start it with one of:");
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

export async function runDoctor(flags: Pick<CliFlags, "host">): Promise<number> {
  const report = await diagnoseOllama(doctorTarget(await loadConfig(flags)));
  const { text, ok } = renderDoctorReport(report);
  console.log(text);
  return ok ? 0 : 1;
}
