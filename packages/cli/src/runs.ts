// Run-directory resolution shared by resume and detail: accept a run id, a
// path, or nothing (= the most recent run).

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { runsRoot } from "@wind-tunnel/core";

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
// lexicographically largest name is the newest.
export async function latestRunDir(): Promise<string> {
  let names: string[];
  try {
    names = await readdir(runsRoot());
  } catch {
    throw new Error(`no runs yet (${runsRoot()}) — start one with: wt-cli run "..."`);
  }
  const latest = names
    .filter((n) => !n.startsWith("."))
    .sort()
    .at(-1);
  if (!latest) throw new Error(`no runs yet (${runsRoot()}) — start one with: wt-cli run "..."`);
  return join(runsRoot(), latest);
}
