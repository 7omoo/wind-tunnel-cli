import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { latestRunDir } from "../src/runs";

let home: string;
let runs: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "wt-runs-"));
  vi.stubEnv("XDG_DATA_HOME", home);
  runs = join(home, "wind-tunnel", "runs");
  await mkdir(runs, { recursive: true });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
});

describe("latestRunDir", () => {
  it("picks the newest run by its timestamped id", async () => {
    await mkdir(join(runs, "20261001-090000-aaaa"));
    await mkdir(join(runs, "20261006-101500-bbbb"));
    expect(await latestRunDir()).toBe(join(runs, "20261006-101500-bbbb"));
  });

  // Names sort after any timestamp, so they used to be taken as "latest".
  it("ignores files and directories that are not runs", async () => {
    await mkdir(join(runs, "20261006-101500-bbbb"));
    await writeFile(join(runs, "notes.txt"), "x");
    await mkdir(join(runs, "scratch"));
    expect(await latestRunDir()).toBe(join(runs, "20261006-101500-bbbb"));
  });

  it("explains how to start when there are no runs", async () => {
    await writeFile(join(runs, "notes.txt"), "x");
    await expect(latestRunDir()).rejects.toThrow("no runs yet");
  });
});
