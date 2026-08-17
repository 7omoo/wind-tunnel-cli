// Full pipeline against a real Ollama daemon with a tiny model. Skipped when
// the daemon or the model is absent, so `pnpm test` stays green anywhere.
//
//   brew services start ollama && ollama pull qwen3:0.6b
//
// This is a structural check, not a quality one: a 0.6B model writes poor
// reactions, but every stage must still produce schema-valid artifacts. That
// is exactly what constrained decoding buys, and what breaks first when a
// prompt or schema regresses.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPipelineModels } from "../src/models/pipeline";
import { getOllamaVersion, isModelInstalled, listInstalledModels } from "../src/ollama/client";
import { createJsonPersonaSource } from "../src/personas/json-source";
import { executeRun } from "../src/run/execute";
import { RunStore } from "../src/run/store";
import type { RunInput } from "../src/run/types";
import { FIXTURE_PERSONAS_JP } from "./fixtures/personas-jp";

const BASE_URL = process.env.OLLAMA_HOST ?? "http://localhost:11434";
const MODEL = "qwen3:0.6b";

const version = await getOllamaVersion(BASE_URL);
const installed = version ? await listInstalledModels(BASE_URL).catch(() => []) : [];
const ready = version !== null && isModelInstalled(installed, MODEL);

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wt-e2e-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe.skipIf(!ready)(`end-to-end pipeline on ${MODEL}`, () => {
  it("produces schema-valid artifacts for every stage", async () => {
    const input: RunInput = {
      schemaVersion: 1,
      runId: "e2e",
      createdAt: new Date().toISOString(),
      topic: "新発売のエナジードリンク。徹夜明けでも一気に目が覚める、頑張る人の味方です。",
      country: "jp",
      situation: "sns_viral",
      personaLang: "ja",
      outputLang: "ja",
      filter: { personaCount: 4 },
      models: {
        bulk: `ollama:${MODEL}`,
        analysis: `ollama:${MODEL}`,
        premium: `ollama:${MODEL}`,
      },
      batch: 4,
    };
    const store = await RunStore.create(root, input);
    const models = await createPipelineModels(input.models, { ollamaBaseUrl: BASE_URL });
    const summary = await executeRun(store, {
      source: createJsonPersonaSource({ personas: FIXTURE_PERSONAS_JP, version: "fixture" }),
      models,
    });

    // React: one reaction per persona, non-empty text.
    const opinions = await store.readOpinions();
    expect(opinions).toHaveLength(4);
    for (const o of opinions) {
      expect(o.text.trim().length).toBeGreaterThan(0);
      expect(o.personaId).toMatch(/^jp-/);
    }

    // Score: one score per opinion, all in range.
    const scores = (await store.readScores())?.scores ?? [];
    expect(scores).toHaveLength(4);
    for (const s of scores) {
      expect(s.score).toBeGreaterThanOrEqual(-100);
      expect(s.score).toBeLessThanOrEqual(100);
    }

    // Verdict: index in range, risk level from the enum.
    const verdict = await store.readAnalyze();
    expect(verdict).not.toBeNull();
    expect(verdict?.inflammationIndex).toBeGreaterThanOrEqual(0);
    expect(verdict?.inflammationIndex).toBeLessThanOrEqual(100);
    expect(["Low", "Medium", "High", "Critical"]).toContain(verdict?.riskLevel);
    expect(summary.flameIndex).toBe(verdict?.inflammationIndex);

    // Cluster: rectangular vote-derived structures, every opinion placed.
    const cluster = await store.readCluster();
    if (cluster) {
      expect(cluster.propositions.length).toBeGreaterThanOrEqual(3);
      expect(cluster.plotData).toHaveLength(4);
      const placed = cluster.clusters.flatMap((c) => c.memberIds);
      expect(new Set(placed).size).toBe(4);
      for (const c of cluster.clusters) {
        expect(c.centroid).toHaveLength(cluster.propositions.length);
      }
    }

    const status = await store.readStatus();
    expect(status?.stage).toBe("done");
  }, 600_000);
});
