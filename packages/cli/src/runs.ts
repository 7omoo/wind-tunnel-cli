// Run-directory resolution shared by resume and detail: accept a run id, a
// path, or nothing (= the most recent run).

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { CuratedError, isRunId, type RunInput, RunStore, runsRoot } from "@wind-tunnel/core";

async function resolveRunDir(idOrPath: string): Promise<string> {
  const candidates = [join(runsRoot(), idOrPath), idOrPath];
  for (const dir of candidates) {
    try {
      if ((await stat(dir)).isDirectory()) return dir;
    } catch {
      // keep trying
    }
  }
  throw new CuratedError(`run not found: ${idOrPath} (looked in ${runsRoot()})`);
}

// Latest run under the runs root. Run ids start with a timestamp, so the
// lexicographically largest id is the newest; other entries are ignored.
export async function latestRunDir(): Promise<string> {
  const root = runsRoot();
  const noRunsYet = () =>
    new CuratedError(`no runs yet (${root}) — start one with: wt-cli run "..."`);
  const names = await readdir(root).catch(() => {
    throw noRunsYet();
  });
  const latest = names.filter(isRunId).sort().at(-1);
  if (!latest) throw noRunsYet();
  return join(root, latest);
}

// Opens a run by id or path (the latest run when omitted) and reads its input —
// the common first step of every command that works on an existing run.
export async function openRun(idOrPath?: string): Promise<{ store: RunStore; input: RunInput }> {
  const dir = idOrPath ? await resolveRunDir(idOrPath) : await latestRunDir();
  const store = await RunStore.open(dir);
  return { store, input: await store.readInput() };
}
