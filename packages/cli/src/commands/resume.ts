// `wt-cli resume <run-id>` — continue an interrupted run from its
// artifacts. Model choices come from the run's own input.json
// (reproducibility); only connection settings (host, API key) come from the
// current config.

import { RunStore } from "@wind-tunnel/core";
import { type CliFlags, loadConfig } from "../config";
import { renderError } from "../errors";
import { paint, useColor } from "../render/format";
import { resolveRunDir } from "../runs";
import { executeAndRender, preflightModels } from "./run";

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
    renderError(e, stderr);
    return 1;
  }
}
