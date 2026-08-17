import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { newRunId } from "../src/run/paths";
import { RunStore } from "../src/run/store";
import type { RunInput } from "../src/run/types";
import type { Opinion } from "../src/types";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wt-store-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function input(runId: string): RunInput {
  return {
    schemaVersion: 1,
    runId,
    createdAt: new Date("2026-08-17T10:00:00Z").toISOString(),
    topic: "テスト投稿",
    country: "jp",
    situation: "sns_viral",
    personaLang: "ja",
    outputLang: "ja",
    filter: { personaCount: 10 },
    models: { bulk: "ollama:qwen3:8b", analysis: "ollama:qwen3:14b", premium: "ollama:qwen3:14b" },
    batch: 5,
  };
}

function opinion(id: string): Opinion {
  return {
    personaId: id,
    name: id,
    text: `意見 ${id}`,
    attributes: {
      age: 30,
      sex: "男",
      occupation: "職業",
      location: "東京都",
      marital_status: "既婚",
    },
  };
}

describe("newRunId", () => {
  it("is sortable and filesystem-safe", () => {
    const id = newRunId(new Date("2026-08-17T14:35:12"));
    expect(id).toMatch(/^20260817-143512-[a-z0-9]{4}$/);
  });
});

describe("RunStore", () => {
  it("creates a run directory with input and status", async () => {
    const store = await RunStore.create(root, input("r1"));
    expect(await store.readInput()).toMatchObject({ runId: "r1", topic: "テスト投稿" });
    const status = await store.readStatus();
    expect(status?.stage).toBe("filter");
    expect(status?.completedAt).toBeNull();
  });

  it("reopens an existing directory and rejects a non-run directory", async () => {
    const store = await RunStore.create(root, input("r2"));
    const reopened = await RunStore.open(store.dir);
    expect((await reopened.readInput()).runId).toBe("r2");
    await expect(RunStore.open(join(root, "nope"))).rejects.toThrow(/not a run directory/);
  });

  it("appends opinions as JSONL and reads them back in order", async () => {
    const store = await RunStore.create(root, input("r3"));
    expect(await store.readOpinions()).toEqual([]);
    await store.appendOpinion(opinion("a"));
    await store.appendOpinion(opinion("b"));
    const read = await store.readOpinions();
    expect(read.map((o) => o.personaId)).toEqual(["a", "b"]);
    // One JSON object per line — the documented public format.
    const raw = await readFile(join(store.dir, "opinions.jsonl"), "utf8");
    expect(raw.trim().split("\n")).toHaveLength(2);
  });

  it("skips a torn final line instead of failing the read (crash mid-append)", async () => {
    const store = await RunStore.create(root, input("r4"));
    await store.appendOpinion(opinion("a"));
    await writeFile(
      join(store.dir, "opinions.jsonl"),
      `${JSON.stringify(opinion("a"))}\n{"person`,
      "utf8",
    );
    const read = await store.readOpinions();
    expect(read.map((o) => o.personaId)).toEqual(["a"]);
  });

  it("distinguishes absent artifacts (undefined) from null results", async () => {
    const store = await RunStore.create(root, input("r5"));
    expect(await store.readAnalyze()).toBeUndefined(); // stage not run
    await store.writeCluster(null); // stage ran, no usable result
    expect(await store.readCluster()).toBeNull();
  });

  it("accumulates warnings and advances the stage marker", async () => {
    const store = await RunStore.create(root, input("r6"));
    await store.patchStatus({ stage: "react", addWarnings: ["w1"] });
    await store.patchStatus({ stage: "score", addWarnings: ["w2"] });
    const status = await store.patchStatus({ stage: "done", completedAt: "2026-08-17T11:00:00Z" });
    expect(status.stage).toBe("done");
    expect(status.warnings).toEqual(["w1", "w2"]);
    expect(status.completedAt).toBe("2026-08-17T11:00:00Z");
  });

  it("writes JSON artifacts atomically (no leftover temp files)", async () => {
    const store = await RunStore.create(root, input("r7"));
    await store.writeScores({
      schemaVersion: 1,
      scores: [{ personaId: "a", score: 5, reason: "" }],
    });
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(store.dir);
    expect(files.some((f) => f.startsWith("."))).toBe(false);
    expect(files).toContain("scores.json");
  });
});
