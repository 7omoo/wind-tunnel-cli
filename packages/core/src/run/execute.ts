// Run executor. Idempotent continuation over the run directory: each stage
// checks its artifact and is skipped when the artifact already exists, so
// `run` (fresh directory) and `resume` (partially filled directory) are the
// same code path. The react stage resumes mid-stage via the opinions JSONL.
//
// Failure semantics:
//   - filter/react/score/verdict failures fail the run (their outputs are the
//     product); status.json records the error.
//   - cluster/suggest failures degrade to a `null` artifact plus a warning —
//     the verdict is still delivered.

import type { LanguageModel } from "ai";
import type { ModelRole } from "../models/defaults";
import type { PipelineModels } from "../models/pipeline";
import type { PipelineStage } from "../models/stages";
import type { PersonaSource } from "../personas/source";
import { analyzeVerdict, scoreOpinions } from "../pipeline/analyze";
import { clusterOpinions } from "../pipeline/cluster";
import { reactPersonas } from "../pipeline/react";
import { type ScoredOpinion, stratifiedSample } from "../pipeline/sample";
import { suggestAlternatives } from "../pipeline/suggest";
import { defaultPersonaLang } from "../schemas";
import type { Opinion, RawPersona } from "../types";
import { opinionsToCsv } from "../util/csv";
import type { RunStore } from "./store";
import type { RunProgressEvent, RunSummary } from "./types";

export type ExecuteDeps = {
  source: PersonaSource;
  models: PipelineModels;
  onEvent?: (event: RunProgressEvent) => void;
};

export async function executeRun(store: RunStore, deps: ExecuteDeps): Promise<RunSummary> {
  const emit = deps.onEvent ?? (() => {});
  const model = (role: ModelRole, stage: PipelineStage): LanguageModel =>
    deps.models.role(role, stage);
  const input = await store.readInput();
  const personaLang = input.personaLang || defaultPersonaLang(input.country);
  const warnings: string[] = [];
  const warn = async (message: string) => {
    warnings.push(message);
    emit({ type: "warning", message });
    await store.patchStatus({ addWarnings: [message] });
  };

  try {
    // ── filter ───────────────────────────────────────────────────────────
    let personasArtifact = await store.readPersonas();
    if (!personasArtifact) {
      emit({ type: "stage", stage: "filter" });
      await store.patchStatus({ stage: "filter" });
      const personas = await deps.source.sample({
        country: input.country,
        ageMin: input.filter.ageMin,
        ageMax: input.filter.ageMax,
        sex: input.filter.sex,
        region: input.filter.region,
        count: input.filter.personaCount,
      });
      if (personas.length === 0) {
        throw new Error("no personas matched the filter — pull a pool or relax the filter");
      }
      personasArtifact = {
        schemaVersion: 1,
        country: input.country,
        poolVersion: await deps.source.poolVersion(input.country),
        personas,
      };
      await store.writePersonas(personasArtifact);
    }
    const personas = personasArtifact.personas;

    // ── react (resumes mid-stage via the JSONL) ──────────────────────────
    const opinions = await store.readOpinions();
    const doneIds = new Set(opinions.map((o) => o.personaId));
    const remaining: RawPersona[] = personas.filter((p) => !doneIds.has(p.uuid));
    if (remaining.length > 0) {
      emit({ type: "stage", stage: "react" });
      await store.patchStatus({ stage: "react" });
      const total = personas.length;
      const generator = reactPersonas({
        topic: input.topic,
        personas: remaining,
        country: input.country,
        situation: input.situation,
        personaLang,
        context: input.context,
        model: model("bulk", "react"),
        concurrency: input.batch,
      });
      let result = await generator.next();
      while (!result.done) {
        const opinion: Opinion = result.value;
        opinions.push(opinion);
        await store.appendOpinion(opinion);
        emit({ type: "opinion", opinion });
        emit({ type: "progress", stage: "react", done: opinions.length, total });
        result = await generator.next();
      }
      if (result.value.failed > 0) {
        await warn(`${result.value.failed}/${result.value.requested} persona reactions failed`);
      }
    }
    if (opinions.length === 0) throw new Error("no opinions generated");

    // ── score ────────────────────────────────────────────────────────────
    let scoresArtifact = await store.readScores();
    if (!scoresArtifact) {
      emit({ type: "stage", stage: "score" });
      await store.patchStatus({ stage: "score" });
      const { scores, warnings: scoreWarnings } = await scoreOpinions({
        topic: input.topic,
        opinions,
        outputLang: input.outputLang,
        model: model("bulk", "score"),
        concurrency: input.batch,
        onProgress: (done, total) => emit({ type: "progress", stage: "score", done, total }),
      });
      for (const w of scoreWarnings) await warn(w);
      scoresArtifact = { schemaVersion: 1, scores };
      await store.writeScores(scoresArtifact);
    }
    const scores = scoresArtifact.scores;

    // ── verdict ──────────────────────────────────────────────────────────
    let verdict = await store.readAnalyze();
    if (verdict === undefined) {
      emit({ type: "stage", stage: "verdict" });
      await store.patchStatus({ stage: "verdict" });
      verdict = await analyzeVerdict({
        topic: input.topic,
        opinions,
        scores,
        outputLang: input.outputLang,
        model: model("analysis", "verdict"),
      });
      await store.writeAnalyze(verdict);
    }

    // ── cluster (non-fatal) ──────────────────────────────────────────────
    let cluster = await store.readCluster();
    if (cluster === undefined) {
      emit({ type: "stage", stage: "cluster" });
      await store.patchStatus({ stage: "cluster" });
      try {
        const scoreById = new Map(scores.map((s) => [s.personaId, s.score]));
        const scored: ScoredOpinion[] = opinions.map((o) => ({
          opinion: o,
          score: scoreById.get(o.personaId) ?? 0,
        }));
        const propositionSample = stratifiedSample(scored, {
          maxCount: 150,
          maxChars: 60000,
        }).map((s) => s.opinion);
        const clusterRun = await clusterOpinions({
          topic: input.topic,
          opinions,
          propositionSample,
          outputLang: input.outputLang,
          models: {
            propositions: model("analysis", "propositions"),
            stances: model("bulk", "stance"),
            axisLabels: model("bulk", "axis_labels"),
            profiles: model("analysis", "profiles"),
          },
          concurrency: input.batch,
          onStanceProgress: (done, total) =>
            emit({ type: "progress", stage: "stance", done, total }),
        });
        for (const w of clusterRun.warnings) await warn(w);
        cluster = clusterRun.result;
      } catch (e) {
        await warn(`cluster stage failed: ${e instanceof Error ? e.message : String(e)}`);
        cluster = null;
      }
      await store.writeCluster(cluster);
    }

    // ── suggest (non-fatal; needs cluster group profiles) ────────────────
    let suggest = await store.readSuggest();
    if (suggest === undefined) {
      if (cluster?.groupProfiles?.length && verdict) {
        emit({ type: "stage", stage: "suggest" });
        await store.patchStatus({ stage: "suggest" });
        try {
          suggest = await suggestAlternatives({
            topic: input.topic,
            cluster,
            verdict,
            outputLang: input.outputLang,
            model: model("premium", "suggest"),
          });
        } catch (e) {
          await warn(`suggest stage failed: ${e instanceof Error ? e.message : String(e)}`);
          suggest = null;
        }
      } else {
        suggest = null;
      }
      await store.writeSuggest(suggest);
    }

    // ── export ───────────────────────────────────────────────────────────
    emit({ type: "stage", stage: "export" });
    await store.patchStatus({ stage: "export" });
    await store.writeCsv(
      opinionsToCsv(opinions, {
        runId: input.runId,
        topic: input.topic,
        country: input.country,
      }),
    );
    await store.patchStatus({ stage: "done", completedAt: new Date().toISOString() });

    return {
      runId: input.runId,
      dir: store.dir,
      opinionCount: opinions.length,
      flameIndex: verdict?.inflammationIndex ?? null,
      riskLevel: verdict?.riskLevel ?? null,
      warnings,
    };
  } catch (e) {
    await store
      .patchStatus({ stage: "failed", error: e instanceof Error ? e.message : String(e) })
      .catch(() => {});
    throw e;
  }
}
