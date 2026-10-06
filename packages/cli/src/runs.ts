// Run-directory resolution shared by resume and detail: accept a run id, a
// path, or nothing (= the most recent run).

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { CuratedError, isRunId, type RunInput, RunStore, runsRoot } from "@wind-tunnel/core";

export async function resolveRunDir(idOrPath: string): Promise<string> {
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

// Latest run under the runs root. Run ids start with a timestamp, so the
// lexicographically largest id is the newest; other entries are ignored.
export async function latestRunDir(): Promise<string> {
  let names: string[];
  try {
    names = await readdir(runsRoot());
  } catch {
    throw new CuratedError(`no runs yet (${runsRoot()}) — start one with: wt-cli run "..."`);
  }
  const latest = names.filter(isRunId).sort().at(-1);
  if (!latest)
    throw new CuratedError(`no runs yet (${runsRoot()}) — start one with: wt-cli run "..."`);
  return join(runsRoot(), latest);
}

// Opens a run by id or path (the latest run when omitted) and reads its input —
// the common first step of every command that works on an existing run.
export async function openRun(idOrPath?: string): Promise<{ store: RunStore; input: RunInput }> {
  const dir = idOrPath ? await resolveRunDir(idOrPath) : await latestRunDir();
  const store = await RunStore.open(dir);
  return { store, input: await store.readInput() };
}
