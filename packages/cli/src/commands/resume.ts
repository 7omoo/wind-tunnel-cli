// `windtunnel resume <run-id>` — continue an interrupted run from its
// artifacts. Model choices come from the run's own input.json
// (reproducibility); only connection settings (host, API key) come from the
// current config.

import { stat } from "node:fs/promises";
import { join } from "node:path";
import { RunStore, runsRoot } from "@wind-tunnel/core";
import { type CliFlags, loadConfig } from "../config";
import { paint, useColor } from "../render/format";
import { executeAndRender, preflightModels } from "./run";

async function resolveRunDir(idOrPath: string): Promise<string> {
  // Accept both a run id (under the runs root) and a directory path.
  const candidates = [join(runsRoot(), idOrPath), idOrPath];
  for (const dir of candidates) {
    try {
      if ((await stat(dir)).isDirectory()) return dir;
    } catch {
      // keep trying
    }
  }
  throw new Error(`run not found: ${idOrPath} (looked in ${runsRoot()})`);
}

export async function resumeCommand(idOrPath: string, flags: CliFlags): Promise<number> {
  const stderr = process.stderr;
  const color = useColor(stderr);
  try {
    const dir = await resolveRunDir(idOrPath);
    const store = await RunStore.open(dir);
    const input = await store.readInput();
    const cfg = await loadConfig(flags);

    const status = await store.readStatus();
    if (status?.stage === "done") {
      stderr.write(`${paint("dim", "run already complete — rendering summary", color)}\n`);
    } else {
      stderr.write(
        `${paint("dim", `resuming ${input.runId} (was: ${status?.stage ?? "unknown"})`, color)}\n`,
      );
    }

    if (!(await preflightModels(input.models, cfg, stderr))) return 1;
    return await executeAndRender(store, cfg, stderr);
  } catch (e) {
    stderr.write(`${paint("red", "✗", color)} ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
}
