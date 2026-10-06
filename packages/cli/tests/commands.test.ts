// In-process command tests: run / resume / detail / personas list called as
// functions against the Ollama stub. The black-box E2E (e2e-cli.test.ts) proves
// the built binary end to end but runs in a child process, invisible to
// coverage; these exercise the command branches and error paths directly.

import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { detailCommand } from "../src/commands/detail";
import { runDoctor } from "../src/commands/doctor";
import { personasListCommand } from "../src/commands/personas";
import { resumeCommand } from "../src/commands/resume";
import { preflightModels, runCommand } from "../src/commands/run";
import { type StubOllama, startStubOllama } from "./helpers/stub-ollama";

const POOL = Array.from({ length: 6 }, (_, i) => ({
  uuid: `usa-${i + 1}`,
  country: "usa",
  age: 25 + i * 5,
  sex: i % 2 === 0 ? "F" : "M",
  sex_norm: i % 2 === 0 ? "F" : "M",
  occupation: ["nurse", "teacher", "mechanic", "designer", "farmer", "cashier"][i] ?? "clerk",
  marital_status: "single",
  education_level: "college",
  region: "TX",
  locality: "Austin",
  professional_persona: `Person ${i + 1}, who reads every label twice.`,
  persona: `A ${25 + i * 5}-year-old.`,
}));

const MODELS = {
  modelBulk: "ollama:stub:8b",
  modelAnalysis: "ollama:stub:8b",
  modelPremium: "ollama:stub:8b",
};

let stub: StubOllama;
let home: string;
let poolFile: string;
const savedEnv: Record<string, string | undefined> = {};

// Isolate from the user's environment: no WT_* / OLLAMA_HOST, XDG in a temp dir.
beforeAll(async () => {
  stub = await startStubOllama();
  home = await mkdtemp(join(tmpdir(), "wt-cmd-"));
  poolFile = join(home, "pool.json");
  await writeFile(poolFile, JSON.stringify(POOL));
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("WT_") || key === "OLLAMA_HOST") {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  }
  for (const key of ["XDG_DATA_HOME", "XDG_CONFIG_HOME"]) {
    savedEnv[key] = process.env[key];
    process.env[key] = home;
  }
});

afterAll(async () => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await stub.close();
  await rm(home, { recursive: true, force: true });
});

// Runs a command with stdout/stderr captured.
async function capture(fn: () => Promise<number>) {
  let stdout = "";
  let stderr = "";
  const out = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  const err = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
  try {
    return { code: await fn(), stdout, stderr };
  } finally {
    out.mockRestore();
    err.mockRestore();
  }
}

describe("commands (in process, against the Ollama stub)", () => {
  let runId = "";

  it("run completes the pipeline and renders the summary", { timeout: 30_000 }, async () => {
    const res = await capture(() =>
      runCommand("Free energy drink for finals week - act now!", {
        personasFile: poolFile,
        country: "usa",
        personas: 6,
        batch: 3,
        host: stub.url,
        ...MODELS,
      }),
    );
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("Backlash index");
    expect(res.stdout).toContain("62 / 100");
    const runs = await readdir(join(home, "wind-tunnel", "runs"));
    expect(runs).toHaveLength(1);
    runId = runs[0] ?? "";
  });

  it("resume of a finished run re-renders without regenerating", async () => {
    const before = stub.chatRequests.length;
    const res = await capture(() => resumeCommand(runId, { host: stub.url }));
    expect(res.code).toBe(0);
    expect(res.stderr).toContain("run already complete");
    expect(res.stdout).toContain("Backlash index");
    expect(stub.chatRequests.length).toBe(before); // no model calls
  });

  it("detail defaults to the latest run and prints every voice", async () => {
    const res = await capture(() => detailCommand(undefined, {}));
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("The offer feels manipulative"); // proposition table
    expect(res.stdout).toContain("nurse");
  });

  it("detail rejects a group number the run doesn't have", async () => {
    const res = await capture(() => detailCommand(runId, { group: 99 }));
    expect(res.code).toBe(1);
    expect(res.stderr).toMatch(/--group must be 1\.\.\d/);
  });

  it("resume reports an unknown run id", async () => {
    const res = await capture(() => resumeCommand("no-such-run", { host: stub.url }));
    expect(res.code).toBe(1);
    expect(res.stderr).toContain("run not found");
  });

  it("run stops before any work when the daemon is unreachable", async () => {
    const res = await capture(() =>
      runCommand("x", { personasFile: poolFile, host: "http://127.0.0.1:9", ...MODELS }),
    );
    expect(res.code).toBe(1);
    expect(res.stderr).toContain("not reachable");
    expect(await readdir(join(home, "wind-tunnel", "runs"))).toHaveLength(1); // nothing new
  });

  it("personas list explains how to get a pool when none is installed", async () => {
    const res = await capture(() => personasListCommand());
    expect(res.stderr + res.stdout).toContain("wt-cli personas pull");
  });
});

describe("doctor (in process)", () => {
  it("passes against a daemon that has the role models", async () => {
    // The stub reports the stub models as installed.
    process.env.WT_MODEL_BULK = MODELS.modelBulk;
    process.env.WT_MODEL_ANALYSIS = MODELS.modelAnalysis;
    process.env.WT_MODEL_PREMIUM = MODELS.modelPremium;
    try {
      const res = await capture(() => runDoctor({ host: stub.url }));
      expect(res.code).toBe(0);
      expect(res.stdout).toContain("daemon reachable");
    } finally {
      delete process.env.WT_MODEL_BULK;
      delete process.env.WT_MODEL_ANALYSIS;
      delete process.env.WT_MODEL_PREMIUM;
    }
  });

  it("fails with start instructions when the daemon is down", async () => {
    const res = await capture(() => runDoctor({ host: "http://127.0.0.1:9" }));
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("daemon not reachable");
  });
});

describe("preflightModels", () => {
  async function preflight(models: { bulk: string; analysis: string; premium: string }, cfg = {}) {
    let stderr = "";
    const stream = {
      isTTY: false,
      write(chunk: string) {
        stderr += chunk;
        return true;
      },
    };
    const ok = await preflightModels(models, cfg, stream as unknown as NodeJS.WriteStream);
    return { ok, stderr };
  }

  it("needs a Gemini key before any gemini role can run", async () => {
    const res = await preflight({ bulk: "gemini:a", analysis: "gemini:a", premium: "gemini:a" });
    expect(res.ok).toBe(false);
    expect(res.stderr).toContain("GEMINI_API_KEY");
    expect(
      (
        await preflight(
          { bulk: "gemini:a", analysis: "gemini:a", premium: "gemini:a" },
          { geminiApiKey: "k" },
        )
      ).ok,
    ).toBe(true);
  });

  it("names the missing Ollama model to pull", async () => {
    const res = await preflight(
      { bulk: "ollama:stub:8b", analysis: "ollama:missing:1b", premium: "ollama:stub:8b" },
      { ollamaHost: stub.url },
    );
    expect(res.ok).toBe(false);
    expect(res.stderr).toContain("ollama pull missing:1b");
  });

  it("reports an unreachable LM Studio server", async () => {
    const res = await preflight(
      { bulk: "lmstudio:a", analysis: "lmstudio:a", premium: "lmstudio:a" },
      { lmstudioHost: "http://127.0.0.1:9" },
    );
    expect(res.ok).toBe(false);
    expect(res.stderr).toContain("LM Studio server not reachable");
  });
});
