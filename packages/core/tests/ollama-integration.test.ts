// Integration tests against a real local Ollama daemon. Skipped automatically
// when the daemon is unreachable or the smoke-test model is missing, so plain
// `pnpm test` stays green on CI. Locally:
//
//   brew services start ollama && ollama pull qwen3:0.6b
//
// What this verifies is exactly the reason the native provider was chosen:
// per-request num_ctx actually reaches the daemon, and structured output
// (AI SDK Output.object -> Ollama `format`) yields schema-valid JSON.

import { generateText, Output } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { resolveModel } from "../src/models/registry";
import { STAGE_NUM_CTX } from "../src/models/stages";
import {
  getOllamaVersion,
  isModelInstalled,
  listInstalledModels,
  listRunningModels,
} from "../src/ollama/client";
import { diagnoseOllama } from "../src/ollama/doctor";

const BASE_URL = process.env.OLLAMA_HOST ?? "http://localhost:11434";
const SMOKE_MODEL = "qwen3:0.6b";

const version = await getOllamaVersion(BASE_URL);
const installed = version ? await listInstalledModels(BASE_URL).catch(() => []) : [];
const daemonUp = version !== null;
const modelReady = daemonUp && isModelInstalled(installed, SMOKE_MODEL);

describe.skipIf(!daemonUp)("ollama daemon probes", () => {
  it("diagnoseOllama reports a reachable daemon with a version", async () => {
    const report = await diagnoseOllama({ baseUrl: BASE_URL });
    expect(report.reachable).toBe(true);
    expect(report.version).toMatch(/^\d+\./);
  });

  it("role checks flag missing ollama models with a pull name", async () => {
    const report = await diagnoseOllama({
      baseUrl: BASE_URL,
      roles: {
        bulk: "ollama:definitely-not-installed-xyz",
        analysis: "gemini:gemini-2.5-flash",
        premium: "gemini:gemini-2.5-flash",
      },
    });
    const bulk = report.roleChecks.find((c) => c.role === "bulk");
    expect(bulk?.installed).toBe(false);
    expect(bulk?.pullName).toBe("definitely-not-installed-xyz");
    const analysis = report.roleChecks.find((c) => c.role === "analysis");
    expect(analysis?.installed).toBeNull(); // cloud — not checkable here
  });
});

describe.skipIf(!modelReady)(`generation via ${SMOKE_MODEL}`, () => {
  it("generates text through the native provider", async () => {
    const model = resolveModel(
      `ollama:${SMOKE_MODEL}`,
      { ollamaBaseUrl: BASE_URL },
      { stage: "react" },
    );
    const { text } = await generateText({
      model,
      system: "You are a 35-year-old engineer from Tokyo. Reply in one short sentence.",
      prompt: "What do you think about remote work?",
    });
    expect(text.trim().length).toBeGreaterThan(0);
  }, 120_000);

  it("passes the stage num_ctx to the daemon (visible in /api/ps context_length)", async () => {
    const model = resolveModel(
      `ollama:${SMOKE_MODEL}`,
      { ollamaBaseUrl: BASE_URL },
      { stage: "score" },
    );
    await generateText({ model, prompt: "Say OK." });
    const running = await listRunningModels(BASE_URL);
    const loaded = running.find((m) => m.name === SMOKE_MODEL);
    expect(loaded).toBeTruthy();
    // Older daemons omit context_length; assert only when reported.
    if (loaded?.contextLength !== undefined) {
      expect(loaded.contextLength).toBe(STAGE_NUM_CTX.score);
    }
  }, 120_000);

  it("produces schema-valid structured output (Output.object -> native format)", async () => {
    const schema = z.object({
      score: z.number(),
      stance: z.enum(["agree", "disagree", "neutral"]),
    });
    const model = resolveModel(
      `ollama:${SMOKE_MODEL}`,
      { ollamaBaseUrl: BASE_URL },
      { stage: "stance" },
    );
    const { output } = await generateText({
      model,
      output: Output.object({ schema }),
      prompt:
        'Classify this opinion about a new product: "I love it, best purchase this year." Score from -100 to 100 and give a stance.',
    });
    const parsed = schema.parse(output);
    expect(parsed.stance).toBeDefined();
    expect(typeof parsed.score).toBe("number");
  }, 120_000);
});
