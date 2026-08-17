// Black-box E2E: the BUILT binary (dist/index.js) spoken to only through argv,
// env and HTTP — no project imports. An in-process stub of the Ollama API
// (helpers/stub-ollama.ts) lets the full pipeline run daemon-less on CI, and
// records every request so the test can assert what actually went over the
// wire: per-stage num_ctx and the constrained-decoding `format` payload — the
// two guarantees the native provider was chosen for.
//
// Skips itself when dist/ is missing: run `pnpm build` first (CI builds before
// testing).

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type StubOllama, startStubOllama } from "./helpers/stub-ollama";

const DIST = fileURLToPath(new URL("../dist/index.js", import.meta.url));

function persona(n: number, age: number, sex: "M" | "F", occupation: string, name: string) {
  return {
    uuid: `usa-${String(n).padStart(3, "0")}`,
    country: "usa",
    age,
    sex,
    sex_norm: sex,
    occupation,
    marital_status: age > 32 ? "married" : "single",
    education_level: "college",
    region: "TX",
    locality: "Austin",
    professional_persona: `${name}, a ${occupation} from Austin who reads every label twice.`,
    persona: `A ${age}-year-old ${occupation}.`,
  };
}

const POOL = Array.from({ length: 8 }, (_, i) =>
  persona(
    i + 1,
    24 + i * 4,
    i % 2 === 0 ? "F" : "M",
    ["nurse", "teacher", "mechanic", "designer", "farmer", "cashier", "lawyer", "barista"][i] ??
      "clerk",
    [
      "Ashley Carter",
      "Ben Ruiz",
      "Carla Mendez",
      "Dan Okafor",
      "Erin Walsh",
      "Frank Liu",
      "Grace Kim",
      "Hank Porter",
    ][i] ?? "Pat Doe",
  ),
);

type CliResult = { code: number | null; stdout: string; stderr: string };

describe.skipIf(!existsSync(DIST))("wt-cli built binary against a stub daemon", () => {
  let stub: StubOllama;
  let home: string; // XDG_DATA_HOME and XDG_CONFIG_HOME both point here
  let poolFile: string;
  let runId: string; // produced by the run test, drilled into by the detail test

  beforeAll(async () => {
    stub = await startStubOllama();
    home = await mkdtemp(join(tmpdir(), "wt-e2e-"));
    poolFile = join(home, "pool.json");
    await writeFile(poolFile, JSON.stringify(POOL));
  });

  afterAll(async () => {
    await stub.close();
    await rm(home, { recursive: true, force: true });
  });

  function cli(args: string[]): Promise<CliResult> {
    // A clean env: the user's WT_* / OLLAMA_HOST must not leak into the test,
    // and XDG isolation keeps runs and config out of the real home.
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && !k.startsWith("WT_") && k !== "OLLAMA_HOST") env[k] = v;
    }
    env.XDG_DATA_HOME = home;
    env.XDG_CONFIG_HOME = home;

    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [DIST, ...args], { env, timeout: 60_000 });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (c) => {
        stdout += String(c);
      });
      child.stderr.on("data", (c) => {
        stderr += String(c);
      });
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    });
  }

  const MODEL_FLAGS = [
    "--model-bulk",
    "ollama:stub:8b",
    "--model-analysis",
    "ollama:stub:8b",
    "--model-premium",
    "ollama:stub:8b",
  ];

  it("runs the full pipeline and replies with the group summary", { timeout: 60_000 }, async () => {
    const res = await cli([
      "run",
      "Free energy drink for finals week - act now!",
      "--personas-file",
      poolFile,
      "--country",
      "usa",
      "--personas",
      "8",
      "--batch",
      "4",
      "--host",
      stub.url,
      ...MODEL_FLAGS,
    ]);

    expect(res.stderr).not.toContain("✗");
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("Backlash index");
    expect(res.stdout).toContain("62 / 100");
    expect(res.stdout).toContain("HIGH");
    expect(res.stdout).toContain("Value Seekers"); // group card, not just numbers

    // The run directory is the public output contract.
    const runs = await readdir(join(home, "wind-tunnel", "runs"));
    expect(runs).toHaveLength(1);
    runId = runs[0] as string;
    const dir = join(home, "wind-tunnel", "runs", runId);
    const status = JSON.parse(await readFile(join(dir, "status.json"), "utf8"));
    expect(status.stage).toBe("done");
    const opinions = (await readFile(join(dir, "opinions.jsonl"), "utf8")).trim().split("\n");
    expect(opinions).toHaveLength(8);
    expect((await readFile(join(dir, "result.csv"), "utf8")).startsWith("\uFEFF")).toBe(true);

    // What went over the wire — the reason the native provider exists:
    // every generation call carries an explicit context budget, and the JSON
    // stages ship their schema as Ollama's `format` for constrained decoding.
    expect(stub.chatRequests.length).toBeGreaterThanOrEqual(8);
    for (const r of stub.chatRequests) {
      expect(r.options?.num_ctx).toBeGreaterThan(0);
    }
    expect(stub.chatRequests.some((r) => r.format && typeof r.format === "object")).toBe(true);
  });

  it("detail drills into the run the summary came from", { timeout: 60_000 }, async () => {
    expect(runId).toBeTruthy();
    const res = await cli(["detail", runId]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("The offer feels manipulative"); // proposition table
    expect(res.stdout).toContain("Reaction"); // full voices
  });

  it("fails fast with a clear message when the daemon is unreachable", {
    timeout: 60_000,
  }, async () => {
    const res = await cli([
      "run",
      "x",
      "--personas-file",
      poolFile,
      "--host",
      "http://127.0.0.1:9",
      ...MODEL_FLAGS,
    ]);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain("not reachable");
    expect(res.stderr).toContain("https://ollama.com/download");
  });
});
