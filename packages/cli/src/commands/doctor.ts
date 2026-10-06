// `wt-cli doctor` — diagnose the local environment for the providers the role
// models use (Ollama and/or LM Studio): reachability, role models present,
// what's loaded right now. Prints the exact fix command for anything missing.
// Exit 1 when the configured setup could not run as-is.

import {
  DEFAULT_LMSTUDIO_URL,
  DEFAULT_OLLAMA_URL,
  diagnoseLmStudio,
  diagnoseOllama,
  type LmStudioDoctorReport,
  loadCommand,
  type ModelRoles,
  needsLargerContext,
  type OllamaDoctorReport,
  parseModelSpec,
} from "@wind-tunnel/core";
import { type CliFlags, loadConfig, type ResolvedConfig } from "../config";

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${bytes} B`;
}

export type DoctorTarget = {
  roles: ModelRoles;
  ollamaBaseUrl: string;
  lmstudioBaseUrl: string;
};

// What to diagnose: the hosts and role models `run` would use, taken from the
// same resolved config (flags > WT_* env > config.toml > defaults), so a pass
// here means the real run sees the same servers and models.
export function doctorTarget(cfg: ResolvedConfig): DoctorTarget {
  return {
    roles: cfg.models,
    ollamaBaseUrl: cfg.ollamaHost ?? DEFAULT_OLLAMA_URL,
    lmstudioBaseUrl: cfg.lmstudioHost ?? DEFAULT_LMSTUDIO_URL,
  };
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
    if (check.provider === "lmstudio") continue; // listed in the LM Studio section
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

export function renderLmStudioReport(report: LmStudioDoctorReport): { text: string; ok: boolean } {
  const lines = [`LM Studio ${report.baseUrl}`];
  if (!report.reachable) {
    lines.push("  ✗ server not reachable");
    lines.push("");
    lines.push("  Not installed?  https://lmstudio.ai");
    lines.push("  Installed — start the server with one of:");
    lines.push("    lms server start                  # CLI");
    lines.push("    Developer tab → Start Server      # app");
    return { text: lines.join("\n"), ok: false };
  }

  let ok = true;
  lines.push("  ✓ server reachable");
  lines.push("");
  lines.push("  Role models:");
  for (const check of report.roleChecks) {
    const pad = check.role.padEnd(9);
    if (!check.available) {
      ok = false;
      lines.push(`  ✗ ${pad} ${check.spec}  missing — run: lms get ${check.model}`);
    } else if (needsLargerContext(check)) {
      ok = false;
      const loaded = check.loadedContext === null ? "not loaded" : `ctx ${check.loadedContext}`;
      lines.push(`  ✗ ${pad} ${check.spec}  ${loaded} — run: ${loadCommand(check)}`);
    } else {
      lines.push(`  ✓ ${pad} ${check.spec}  ctx ${check.loadedContext}`);
    }
  }
  lines.push("");
  lines.push("  Note: prefer non-thinking models (e.g. qwen/qwen3-4b-2507). LM Studio");
  lines.push("  cannot turn thinking off per request, which stalls persona reactions.");
  return { text: lines.join("\n"), ok };
}

export async function runDoctor(flags: Pick<CliFlags, "host">): Promise<number> {
  const target = doctorTarget(await loadConfig(flags));
  const providers = new Set(
    Object.values(target.roles).map((spec) => parseModelSpec(spec).provider),
  );

  const sections: { text: string; ok: boolean }[] = [];
  if (providers.has("ollama")) {
    sections.push(
      renderDoctorReport(
        await diagnoseOllama({ baseUrl: target.ollamaBaseUrl, roles: target.roles }),
      ),
    );
  }
  if (providers.has("lmstudio")) {
    sections.push(
      renderLmStudioReport(
        await diagnoseLmStudio({ baseUrl: target.lmstudioBaseUrl, roles: target.roles }),
      ),
    );
  }
  if (sections.length === 0) {
    sections.push({
      text: "No local model providers configured (all roles are cloud models).",
      ok: true,
    });
  }

  console.log(sections.map((s) => s.text).join("\n\n"));
  return sections.every((s) => s.ok) ? 0 : 1;
}
