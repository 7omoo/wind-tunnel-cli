// LLM stages of the opinion-cluster analysis. The numeric side (PCA, k-means,
// consensus detection) lives in analysis/clustering.ts and pipeline/cluster.ts;
// this module owns everything that talks to a model. All JSON returns through
// constrained decoding with strict generation schemas.

import { generateText, type LanguageModel, Output } from "ai";
import { z } from "zod";
import { findMinorityDivergence } from "../analysis/clustering";
import { ANALYSIS_TEMPERATURE, stageTimeoutSignal } from "../models/stages";
import {
  axisLabelPrompts,
  profilePrompts,
  propositionPrompts,
  stancePrompts,
} from "../prompts/cluster";
import type {
  Opinion,
  OpinionCluster,
  OpinionClusterGroupProfile,
  OpinionClusterMinorityReport,
  OpinionClusterProposition,
  OutputLang,
} from "../types";
import { chunk, mapWaves } from "./batch";

export const STANCE_BATCH_SIZE = 10;

// === Propositions (analysis model, one call on a sample) ===

export async function extractPropositions(opts: {
  topic: string;
  opinions: Opinion[]; // pre-sampled by the caller
  outputLang: OutputLang;
  model: LanguageModel;
}): Promise<OpinionClusterProposition[]> {
  const schema = z.object({
    propositions: z
      .array(z.object({ text: z.string() }))
      .min(3)
      .max(15),
  });
  const { output } = await generateText({
    model: opts.model,
    temperature: ANALYSIS_TEMPERATURE,
    abortSignal: stageTimeoutSignal("propositions"),
    output: Output.object({ schema }),
    ...propositionPrompts(opts),
  });
  // Ids are assigned here, not by the model — sequential and collision-free.
  return output.propositions.map((p, i) => ({ id: `p${i + 1}`, text: p.text }));
}

// === Stance classification (bulk model, batched) ===
// Returns the vote matrix: rows = opinions (original order), columns =
// propositions, values +1/-1/0. The generation schema pins BOTH dimensions
// (rows per batch, votes per row), so a malformed shape cannot come back —
// a hard improvement over prompt-JSON, where shape drift silently zeroed rows.

export async function classifyStances(opts: {
  opinions: Opinion[];
  propositions: OpinionClusterProposition[];
  model: LanguageModel;
  concurrency: number;
  batchSize?: number;
  onProgress?: (done: number, total: number) => void;
}): Promise<{ voteMatrix: number[][]; warnings: string[] }> {
  const batchSize = opts.batchSize ?? STANCE_BATCH_SIZE;
  const batches = chunk(opts.opinions, batchSize);
  const pCount = opts.propositions.length;

  const settled = await mapWaves(
    batches,
    opts.concurrency,
    async (batch) => {
      const schema = z.object({
        votes: z
          .array(z.array(z.union([z.literal(-1), z.literal(0), z.literal(1)])).length(pCount))
          .length(batch.length),
      });
      const { output } = await generateText({
        model: opts.model,
        temperature: ANALYSIS_TEMPERATURE,
        abortSignal: stageTimeoutSignal("stance"),
        output: Output.object({ schema }),
        ...stancePrompts(opts.propositions, batch),
      });
      return output.votes;
    },
    opts.onProgress,
  );

  const voteMatrix: number[][] = [];
  const warnings: string[] = [];
  let failedBatches = 0;
  let lastFailure: unknown;
  settled.forEach((result, i) => {
    if (result.status === "fulfilled") {
      voteMatrix.push(...result.value);
    } else {
      // A failed batch degrades to all-neutral rows (the original behavior);
      // reported so a run summary can show classification coverage.
      failedBatches++;
      lastFailure = result.reason;
      const batch = batches[i] ?? [];
      for (const _ of batch) voteMatrix.push(new Array<number>(pCount).fill(0));
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
      warnings.push(`stance batch ${i + 1}/${batches.length} failed (rows neutral): ${reason}`);
    }
  });
  if (failedBatches === batches.length && batches.length > 0) {
    // An all-neutral matrix would cluster into a fabricated single camp, so a
    // total outage fails like the score stage; cause kept for the CLI classifier.
    throw new Error(`all ${batches.length} stance batches failed`, { cause: lastFailure });
  }
  return { voteMatrix, warnings };
}

// === Axis labels (bulk model, one call for all k axes) ===

export async function labelAxes(opts: {
  propositions: OpinionClusterProposition[];
  loadings: number[][];
  k: number;
  outputLang: OutputLang;
  model: LanguageModel;
}): Promise<string[]> {
  const fallback = Array.from({ length: opts.k }, (_, i) => `PC${i + 1}`);
  const topByAxis = Array.from({ length: opts.k }, (_, c) =>
    opts.propositions
      .map((p, i) => ({ text: p.text, loading: opts.loadings[i]?.[c] ?? 0 }))
      .sort((a, b) => Math.abs(b.loading) - Math.abs(a.loading))
      .slice(0, 3),
  );
  try {
    const schema = z.object({ labels: z.array(z.string()).length(opts.k) });
    const { output } = await generateText({
      model: opts.model,
      temperature: ANALYSIS_TEMPERATURE,
      abortSignal: stageTimeoutSignal("axis_labels"),
      output: Output.object({ schema }),
      ...axisLabelPrompts({ k: opts.k, topByAxis, outputLang: opts.outputLang }),
    });
    return fallback.map((fb, i) => output.labels[i] || fb);
  } catch {
    return fallback; // labels are cosmetic — the map still works as PC1..PCk
  }
}

// === Group profiles + minority report (analysis model, one combined call) ===

export async function generateGroupProfilesAndMinority(opts: {
  clusters: OpinionCluster[];
  propositions: OpinionClusterProposition[];
  opinions: Opinion[];
  outputLang: OutputLang;
  model: LanguageModel;
}): Promise<{
  groupProfiles: OpinionClusterGroupProfile[];
  minorityReport: OpinionClusterMinorityReport | null;
  warnings: string[];
}> {
  const { clusters, propositions } = opts;

  // Minority divergence is computed numerically before the call; the model only
  // interprets it (never re-derives the numbers).
  const minority = findMinorityDivergence(clusters, propositions);
  const hasMinority = minority !== null;
  const minCluster = minority?.cluster ?? null;
  const divergences = minority?.divergences ?? [];
  const totalSize = clusters.reduce((sum, c) => sum + c.size, 0);

  const groupSchema = z.object({
    name: z.string(),
    coreBelief: z.string(),
    keyValues: z.array(z.string()).min(1).max(5),
    representativeQuote: z.string(),
  });
  const schema = hasMinority
    ? z.object({
        groups: z.array(groupSchema).length(clusters.length),
        minority: z.object({
          narrative: z.string(),
          blindSpots: z.array(z.string()).min(1).max(3),
        }),
      })
    : z.object({ groups: z.array(groupSchema).length(clusters.length) });

  const warnings: string[] = [];
  // The generation schema is one of two shapes (with/without minority), so its
  // inferred type is a union that narrows poorly at the read sites. Read it
  // through the superset instead — the schema still constrains what the model
  // may return.
  type ProfilesOutput = {
    groups: z.infer<typeof groupSchema>[];
    minority?: { narrative: string; blindSpots: string[] };
  };
  let raw: ProfilesOutput | null = null;
  try {
    const { output } = await generateText({
      model: opts.model,
      temperature: ANALYSIS_TEMPERATURE,
      abortSignal: stageTimeoutSignal("profiles"),
      output: Output.object({ schema }),
      ...profilePrompts({ ...opts, minority, totalSize }),
    });
    raw = output as ProfilesOutput;
  } catch (e) {
    // One combined call means one failure loses all profiles; degrade to
    // defaults rather than failing the whole cluster stage.
    warnings.push(
      `group profiles failed (defaults used): ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const groupProfiles: OpinionClusterGroupProfile[] = clusters.map((cluster, gi) => {
    const g = raw?.groups[gi];
    return g
      ? { clusterId: cluster.id, ...g }
      : { clusterId: cluster.id, name: "", coreBelief: "", keyValues: [], representativeQuote: "" };
  });

  let minorityReport: OpinionClusterMinorityReport | null = null;
  if (hasMinority && minCluster) {
    const m = raw?.minority ?? null;
    minorityReport = {
      clusterId: minCluster.id,
      clusterSize: minCluster.size,
      totalSize,
      narrative: m?.narrative ?? "",
      blindSpots: m?.blindSpots ?? [],
      topDivergences: divergences,
    };
  }

  return { groupProfiles, minorityReport, warnings };
}
