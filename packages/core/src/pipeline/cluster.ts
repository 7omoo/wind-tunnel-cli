// Cluster stage orchestration: propositions -> vote matrix -> PCA -> k-means
// -> consensus / division / bridging / minority / group profiles.
// Numeric analysis is local math; the model is only asked for semantics
// (propositions, stances, labels, profiles).

import type { LanguageModel } from "ai";
import { kmeans } from "ml-kmeans";
import { PCA } from "ml-pca";
import {
  computeBridging,
  detectConsensus,
  detectDivision,
  silhouette,
} from "../analysis/clustering";
import type { Opinion, OpinionClusterResult, OutputLang } from "../types";
import { sanitizePromptInput } from "../util/sanitize";
import {
  classifyStances,
  extractPropositions,
  generateGroupProfilesAndMinority,
  labelAxes,
} from "./cluster-stages";

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
  const topic = sanitizePromptInput(opts.topic);
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
  const AXIS_COUNT = Math.min(5, projected[0]?.length ?? 2);
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

  // Phase 5: k-means on the vote matrix (not the projection), k chosen by silhouette.
  let bestK = 2;
  let bestScore = -1;
  let bestLabels: number[] = [];
  const maxK = Math.min(5, Math.floor(opinions.length / 2));
  for (let k = 2; k <= maxK; k++) {
    const result = kmeans(voteMatrix, k, { initialization: "kmeans++" });
    const score = silhouette(voteMatrix, result.clusters);
    if (score > bestScore) {
      bestScore = score;
      bestK = k;
      bestLabels = result.clusters;
    }
  }

  const clusters = Array.from({ length: bestK }, (_, k) => {
    const memberIndices = bestLabels.map((l, i) => (l === k ? i : -1)).filter((i) => i >= 0);
    const memberIds = memberIndices
      .map((i) => opinions[i]?.personaId)
      .filter((id): id is string => id !== undefined);
    const centroid = propositions.map((_, j) => {
      const sum = memberIndices.reduce((acc, i) => acc + (voteMatrix[i]?.[j] ?? 0), 0);
      return memberIndices.length > 0 ? sum / memberIndices.length : 0;
    });
    return { id: k, size: memberIds.length, centroid, memberIds };
  });

  // Phases 6-8: consensus / division / bridging (pure math).
  const consensus = detectConsensus(voteMatrix, bestLabels, propositions);
  const divisive = detectDivision(voteMatrix, bestLabels, propositions);
  const bridging = computeBridging(voteMatrix, bestLabels, propositions);

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

  const axes = axisLabels.map((label, i) => ({
    label,
    variancePct: Math.round((explainedVariance[i] ?? 0) * 1000) / 10,
  }));

  const result: OpinionClusterResult = {
    propositions,
    clusters,
    plotData,
    consensus: consensus.slice(0, 5),
    divisive: divisive.slice(0, 5),
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
