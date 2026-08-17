// End-to-end pipeline over mock models: filter -> react -> score -> verdict
// -> cluster -> suggest -> export, plus the resume semantics that make a long
// local run interruptible.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LanguageModel } from "ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ModelRole } from "../src/models/defaults";
import type { PipelineModels } from "../src/models/pipeline";
import { createJsonPersonaSource } from "../src/personas/json-source";
import { executeRun } from "../src/run/execute";
import { RunStore } from "../src/run/store";
import type { RunInput, RunProgressEvent } from "../src/run/types";
import { FIXTURE_PERSONAS_JP } from "./fixtures/personas-jp";
import { textModel } from "./helpers/mock-model";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wt-run-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function input(overrides: Partial<RunInput> = {}): RunInput {
  return {
    schemaVersion: 1,
    runId: "test-run",
    createdAt: new Date("2026-08-17T10:00:00Z").toISOString(),
    topic: "新サービスの告知文です",
    country: "jp",
    situation: "sns_viral",
    personaLang: "ja",
    outputLang: "ja",
    filter: { personaCount: 8 },
    models: { bulk: "ollama:mock", analysis: "ollama:mock", premium: "ollama:mock" },
    batch: 4,
    ...overrides,
  };
}

// One mock brain routed by prompt shape, standing in for all three roles.
function pipelineModels(opts: { failCluster?: boolean } = {}): PipelineModels & {
  callsByRole: Map<ModelRole, number>;
} {
  const callsByRole = new Map<ModelRole, number>();
  const model = textModel((prompt) => {
    if (prompt.includes("Score every reaction")) {
      const ids = [...prompt.matchAll(/^\[([^\]]+)\]/gm)].map((m) => m[1] as string);
      return JSON.stringify({
        scores: ids.map((personaId, i) => ({
          personaId,
          stance: i % 2 === 0 ? "critical" : "favorable",
          intensity: i % 2 === 0 ? 60 : 55,
          reason: "理由",
        })),
      });
    }
    if (prompt.includes("Extract 10-15 specific propositions")) {
      if (opts.failCluster) throw new Error("propositions unavailable");
      // At least 3 — the generation schema's minimum.
      return JSON.stringify({
        propositions: [{ text: "命題A" }, { text: "命題B" }, { text: "命題C" }],
      });
    }
    if (prompt.includes("Return votes as one row per opinion")) {
      const rows = [...prompt.matchAll(/^Opinion \d+: "(.+)"$/gm)].map((_, i) =>
        i % 2 === 0 ? [1, -1, 1] : [-1, 1, -1],
      );
      return JSON.stringify({ votes: rows });
    }
    if (prompt.includes("principal component axes")) {
      // The stage asks for exactly k labels; k follows the component count.
      const k = Number(prompt.match(/Return exactly (\d+) labels/)?.[1] ?? 2);
      return JSON.stringify({ labels: Array.from({ length: k }, (_, i) => `軸${i + 1}A ←→ B`) });
    }
    if (prompt.includes("group profiles")) {
      const count = Number(prompt.match(/Return exactly (\d+) group profiles/)?.[1] ?? 2);
      return JSON.stringify({
        groups: Array.from({ length: count }, (_, i) => ({
          name: `グループ${i + 1}`,
          coreBelief: "信念",
          keyValues: ["価値"],
          representativeQuote: "発言",
        })),
        minority: { narrative: "少数派", blindSpots: ["盲点"] },
      });
    }
    if (prompt.includes("alternatives")) {
      return JSON.stringify({
        alternatives: [
          {
            text: "書き換え案1",
            strategy: "具体化",
            targetTriggers: [0, 99],
            estimatedRiskReduction: "High",
            reasoning: "理由",
          },
          {
            text: "書き換え案2",
            strategy: "緩和",
            targetTriggers: [],
            estimatedRiskReduction: "Medium",
            reasoning: "理由",
          },
        ],
        commonGround: "共通の価値",
      });
    }
    if (prompt.includes("投稿内容") && prompt.includes("集計")) {
      return JSON.stringify({
        inflammationIndex: 62,
        riskLevel: "High",
        summary: "反発が想定されます。",
        triggers: [
          {
            expression: "問題の表現",
            offendedSegment: "特定の層",
            severity: "High",
            count: 4,
            sampleOpinionIds: ["jp-001"],
          },
        ],
        safeVersion: "安全な言い換え",
      });
    }
    return "これは反応です。";
  });
  return {
    role(role: ModelRole, _stage): LanguageModel {
      callsByRole.set(role, (callsByRole.get(role) ?? 0) + 1);
      return model;
    },
    callsByRole,
  };
}

const source = () =>
  createJsonPersonaSource({ personas: FIXTURE_PERSONAS_JP, version: "fixture-12" });

describe("executeRun", () => {
  it("runs every stage and writes the full artifact set", async () => {
    const store = await RunStore.create(root, input());
    const events: RunProgressEvent[] = [];
    const summary = await executeRun(store, {
      source: source(),
      models: pipelineModels(),
      onEvent: (e) => events.push(e),
    });

    expect(summary.opinionCount).toBe(8);
    expect(summary.flameIndex).toBe(62);
    expect(summary.riskLevel).toBe("High");
    expect(summary.warnings).toEqual([]);

    const personas = await store.readPersonas();
    expect(personas?.personas).toHaveLength(8);
    expect(personas?.poolVersion).toBe("fixture-12");
    expect(await store.readOpinions()).toHaveLength(8);
    expect((await store.readScores())?.scores).toHaveLength(8);
    expect((await store.readAnalyze())?.inflammationIndex).toBe(62);
    expect((await store.readCluster())?.clusters.length).toBeGreaterThanOrEqual(2);

    const suggest = await store.readSuggest();
    expect(suggest?.alternatives).toHaveLength(2);
    expect(suggest?.alternatives[0]?.id).toBe("alt-1");
    // Out-of-range trigger references are clamped away (99 dropped, 0 kept).
    expect(suggest?.alternatives[0]?.targetTriggers).toEqual([0]);

    const status = await store.readStatus();
    expect(status?.stage).toBe("done");
    expect(status?.completedAt).toBeTruthy();

    const { readFile } = await import("node:fs/promises");
    const csv = await readFile(join(store.dir, "result.csv"), "utf8");
    expect(csv.split("\r\n")[0]).toContain("run_id,topic,country,persona_id");
    expect(csv.split("\r\n")).toHaveLength(10); // header + 8 rows + trailing

    // The caller can render live progress from the event stream.
    expect(events.filter((e) => e.type === "opinion")).toHaveLength(8);
    expect(events.some((e) => e.type === "stage" && e.stage === "verdict")).toBe(true);
    expect(events.some((e) => e.type === "progress" && e.stage === "react" && e.done === 8)).toBe(
      true,
    );
  });

  it("resumes a partially reacted run without regenerating existing opinions", async () => {
    const store = await RunStore.create(root, input());
    // Simulate an interrupt: personas chosen, 3 of 8 reactions already on disk.
    const personas = FIXTURE_PERSONAS_JP.slice(0, 8);
    await store.writePersonas({
      schemaVersion: 1,
      country: "jp",
      poolVersion: "fixture-12",
      personas,
    });
    for (const p of personas.slice(0, 3)) {
      await store.appendOpinion({
        personaId: p.uuid,
        name: "既存",
        text: "以前に生成された反応",
        attributes: {
          age: p.age,
          sex: p.sex,
          occupation: p.occupation,
          location: p.locality ?? "",
          marital_status: p.marital_status,
        },
      });
    }

    const events: RunProgressEvent[] = [];
    const summary = await executeRun(await RunStore.open(store.dir), {
      source: source(),
      models: pipelineModels(),
      onEvent: (e) => events.push(e),
    });

    expect(summary.opinionCount).toBe(8);
    // Only the 5 missing personas were generated this time.
    expect(events.filter((e) => e.type === "opinion")).toHaveLength(5);
    const opinions = await store.readOpinions();
    expect(opinions.filter((o) => o.text === "以前に生成された反応")).toHaveLength(3);
    expect(new Set(opinions.map((o) => o.personaId)).size).toBe(8);
  });

  it("skips completed stages on a second run (idempotent continuation)", async () => {
    const store = await RunStore.create(root, input());
    await executeRun(store, { source: source(), models: pipelineModels() });

    const second = pipelineModels();
    const events: RunProgressEvent[] = [];
    const summary = await executeRun(await RunStore.open(store.dir), {
      source: source(),
      models: second,
      onEvent: (e) => events.push(e),
    });
    expect(summary.flameIndex).toBe(62);
    // Nothing left to do: no reaction, no LLM stage — only the export step.
    expect(events.filter((e) => e.type === "opinion")).toHaveLength(0);
    expect(second.callsByRole.size).toBe(0);
    expect(events.filter((e) => e.type === "stage").map((e) => e.stage)).toEqual(["export"]);
  });

  it("still delivers the verdict when the cluster stage fails (non-fatal)", async () => {
    const store = await RunStore.create(root, input());
    const summary = await executeRun(store, {
      source: source(),
      models: pipelineModels({ failCluster: true }),
    });

    expect(summary.flameIndex).toBe(62); // verdict survived
    expect(await store.readCluster()).toBeNull(); // stage ran, no usable result
    expect(await store.readSuggest()).toBeNull(); // suggest needs group profiles
    expect(summary.warnings.some((w) => w.includes("cluster stage failed"))).toBe(true);
    const status = await store.readStatus();
    expect(status?.stage).toBe("done");
    expect(status?.warnings.some((w) => w.includes("cluster stage failed"))).toBe(true);
  });

  it("fails the run and records the error when no personas match", async () => {
    const store = await RunStore.create(
      root,
      input({ filter: { personaCount: 5, region: "存在しない地方" } }),
    );
    await expect(executeRun(store, { source: source(), models: pipelineModels() })).rejects.toThrow(
      /no personas matched/,
    );
    const status = await store.readStatus();
    expect(status?.stage).toBe("failed");
    expect(status?.error).toMatch(/no personas matched/);
  });
});
