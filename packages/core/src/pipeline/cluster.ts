// Cluster stage orchestration: propositions -> vote matrix -> PCA -> k-means
// -> consensus / division / bridging / minority / group profiles.
// Numeric analysis is local math; the model is only asked for semantics
// (propositions, stances, labels, profiles).

import type { LanguageModel } from "ai";
import { PCA } from "ml-pca";
import {
  buildClusters,
  computeBridging,
  detectConsensus,
  detectDivision,
  isConsensus,
  partitionVotes,
  TOP_PROPOSITIONS,
} from "../analysis/clustering";
import type { Opinion, OpinionClusterResult, OutputLang } from "../types";
import { clampPromptInput } from "../util/sanitize";
import {
  classifyStances,
  extractPropositions,
  generateGroupProfilesAndMinority,
  labelAxes,
} from "./cluster-stages";

// PCA axes kept for the map (PC1/PC2 are the defaults; the rest are selectable).
const MAX_AXES = 5;

export type ClusterModels = {
  propositions: LanguageModel; // analysis role
  stances: LanguageModel; // bulk role
  axisLabels: LanguageModel; // bulk role
  profiles: LanguageModel; // analysis role
};

export type ClusterOptions = {
  topic: string;
  opinions: Opinion[];
  // Pre-sampled subset used for proposition extraction (whole-corpus reading);
  // stance classification always covers every opinion.
  propositionSample: Opinion[];
  outputLang: OutputLang;
  models: ClusterModels;
  concurrency: number;
  onStanceProgress?: (done: number, total: number) => void;
};

export async function clusterOpinions(
  opts: ClusterOptions,
): Promise<{ result: OpinionClusterResult; warnings: string[] }> {
  const { opinions } = opts;
  if (opinions.length < 3) {
    throw new Error(`not enough opinions to cluster (${opinions.length} < 3)`);
  }
  const topic = clampPromptInput(opts.topic);
  const warnings: string[] = [];

  // Phase 1: propositions (from the sample).
  const propositions = await extractPropositions({
    topic,
    opinions: opts.propositionSample,
    outputLang: opts.outputLang,
    model: opts.models.propositions,
  });
  if (propositions.length === 0) throw new Error("no propositions extracted");

  // Phase 2: vote matrix (every opinion).
  const { voteMatrix, warnings: stanceWarnings } = await classifyStances({
    opinions,
    propositions,
    model: opts.models.stances,
    concurrency: opts.concurrency,
    onProgress: opts.onStanceProgress,
  });
  warnings.push(...stanceWarnings);

  // Phase 3: PCA on the vote matrix. Keep the top-k principal components so a
  // map can put any two of them on x/y (PC1/PC2 stay the defaults).
  const pca = new PCA(voteMatrix);
  const projected = pca.predict(voteMatrix).to2DArray();
  const AXIS_COUNT = Math.min(MAX_AXES, projected[0]?.length ?? 2);
  const plotData = opinions.map((o, i) => {
    const row = projected[i] ?? [];
    return {
      personaId: o.personaId,
      x: row[0] ?? 0,
      y: row[1] ?? 0,
      coords: row.slice(0, AXIS_COUNT),
    };
  });

  // Phase 4 runs concurrently with 5-8 (it only needs loadings).
  const loadings = pca.getLoadings().to2DArray();
  const explainedVariance = pca.getExplainedVariance();
  const axisLabelsPromise = labelAxes({
    propositions,
    loadings,
    k: AXIS_COUNT,
    outputLang: opts.outputLang,
    model: opts.models.axisLabels,
  });

  // Phase 5: opinion groups (k-means on the votes, k by silhouette, honesty rule).
  const { k, labels } = partitionVotes(voteMatrix);
  const clusters = buildClusters(
    labels,
    k,
    voteMatrix,
    opinions.map((o) => o.personaId),
  );

  // Phases 6-8: consensus / division / bridging (pure math). Division and
  // bridging are between-group concepts — meaningless for a single camp.
  const consensus = detectConsensus(voteMatrix, labels, propositions);
  const divisive = clusters.length >= 2 ? detectDivision(voteMatrix, labels, propositions) : [];
  const bridging = clusters.length >= 2 ? computeBridging(voteMatrix, labels, propositions) : [];

  // Phases 4 + 9/10 in parallel.
  const [axisLabels, profilesAndMinority] = await Promise.all([
    axisLabelsPromise,
    generateGroupProfilesAndMinority({
      clusters,
      propositions,
      opinions,
      outputLang: opts.outputLang,
      model: opts.models.profiles,
    }),
  ]);
  warnings.push(...profilesAndMinority.warnings);

  // A degenerate PCA (zero-variance vote matrix) yields NaN variance ratios,
  // which would serialize to null in the artifact — clamp to 0.
  const axes = axisLabels.map((label, i) => {
    const ratio = explainedVariance[i] ?? 0;
    return { label, variancePct: Number.isFinite(ratio) ? Math.round(ratio * 1000) / 10 : 0 };
  });

  const result: OpinionClusterResult = {
    propositions,
    clusters,
    plotData,
    consensus: consensus.filter(isConsensus).slice(0, TOP_PROPOSITIONS),
    divisive: divisive.slice(0, TOP_PROPOSITIONS),
    xAxisLabel: axes[0]?.label ?? "PC1",
    yAxisLabel: axes[1]?.label ?? "PC2",
    axes,
    groupProfiles:
      profilesAndMinority.groupProfiles.length > 0 ? profilesAndMinority.groupProfiles : undefined,
    bridging: bridging.length > 0 ? bridging : undefined,
    minorityReport: profilesAndMinority.minorityReport,
  };
  return { result, warnings };
}
