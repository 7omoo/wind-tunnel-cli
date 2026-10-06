// Pure numeric functions for the vote-matrix opinion-cluster analysis.
// No LLM, network, or fs access — kept separate for testability.

import { kmeans } from "ml-kmeans";
import type {
  OpinionCluster,
  OpinionClusterBridging,
  OpinionClusterConsensus,
  OpinionClusterDivisive,
  OpinionClusterProposition,
} from "../types";

/**
 * Silhouette coefficient (for choosing k in k-means).
 * For each point: a = mean intra-cluster distance, b = mean distance to the
 * nearest other cluster; score = (b - a) / max(a, b), averaged over all points.
 * Points in singleton clusters score 0.
 */
export function silhouette(data: number[][], labels: number[]): number {
  const n = data.length;
  if (n <= 1) return 0;

  const uniqueLabels = [...new Set(labels)];
  if (uniqueLabels.length <= 1) return 0;

  function dist(a: number[], b: number[]): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      // Vote-matrix rows all share one length (= proposition count), so the
      // index is populated on both sides; the type system can't guarantee it,
      // so missing entries fall back to 0 (unreachable under the invariant).
      const av = a[i] ?? 0;
      const bv = b[i] ?? 0;
      sum += (av - bv) ** 2;
    }
    return Math.sqrt(sum);
  }

  let totalS = 0;
  for (let i = 0; i < n; i++) {
    const myLabel = labels[i];
    // i < n = data.length, so the row exists; fall back to [] for the type system.
    const rowI = data[i] ?? [];

    // a(i) = average distance to same cluster
    let sameCount = 0;
    let sameSum = 0;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      if (labels[j] === myLabel) {
        sameSum += dist(rowI, data[j] ?? []);
        sameCount++;
      }
    }
    // A point alone in its cluster has no a(i); by convention (Rousseeuw 1987)
    // s(i) = 0. Letting a = 0 here would score it a perfect 1 and make a stray
    // singleton look like real structure.
    if (sameCount === 0) continue;
    const a = sameSum / sameCount;

    // b(i) = min average distance to other clusters
    let b = Infinity;
    for (const label of uniqueLabels) {
      if (label === myLabel) continue;
      let otherSum = 0;
      let otherCount = 0;
      for (let j = 0; j < n; j++) {
        if (labels[j] === label) {
          otherSum += dist(rowI, data[j] ?? []);
          otherCount++;
        }
      }
      if (otherCount > 0) {
        b = Math.min(b, otherSum / otherCount);
      }
    }
    if (b === Infinity) b = 0;

    const s = Math.max(a, b) > 0 ? (b - a) / Math.max(a, b) : 0;
    totalS += s;
  }

  return totalS / n;
}

// How many consensus / divisive / bridging propositions a result keeps.
export const TOP_PROPOSITIONS = 5;

// A bridging proposition needs more than this agree rate (0..1) in every group.
const BRIDGING_MIN_SUPPORT = 0.3;

// Upper bound on the number of opinion groups tried by k-means.
export const MAX_K = 5;

// Below this best silhouette, any split is treated as fabricated structure
// (Kaufman & Rousseeuw's "no substantial structure" threshold).
export const SILHOUETTE_MIN = 0.25;

// Fixed k-means++ seed: the same vote matrix must always yield the same groups,
// otherwise re-running an identical run can change the number of camps.
const KMEANS_SEED = 42;

/**
 * Splits the vote matrix rows into opinion groups: k-means (on the votes, not
 * a projection) for k = 2..min(MAX_K, n/2), keeping the k with the best
 * silhouette. Honesty rule: k-means always returns k groups, even for a
 * unanimous corpus — which then reads as two camps with near-identical beliefs
 * (observed in production) — so a best silhouette below SILHOUETTE_MIN
 * collapses to a single group.
 */
export function partitionVotes(voteMatrix: number[][]): { k: number; labels: number[] } {
  let best = { k: 1, labels: voteMatrix.map(() => 0), score: -1 };
  const maxK = Math.min(MAX_K, Math.floor(voteMatrix.length / 2));
  for (let k = 2; k <= maxK; k++) {
    const { clusters: labels } = kmeans(voteMatrix, k, {
      initialization: "kmeans++",
      seed: KMEANS_SEED,
    });
    const score = silhouette(voteMatrix, labels);
    if (score > best.score) best = { k, labels, score };
  }
  if (best.score < SILHOUETTE_MIN) return { k: 1, labels: voteMatrix.map(() => 0) };
  return { k: best.k, labels: best.labels };
}

/**
 * Groups rows by label into clusters with their mean vote (centroid) and
 * member ids. Labels with no members — k-means can leave a centroid on votes
 * another one already covers — are dropped rather than shown as "group N (0)".
 */
export function buildClusters(
  labels: number[],
  k: number,
  voteMatrix: number[][],
  memberIds: string[],
): OpinionCluster[] {
  const width = voteMatrix[0]?.length ?? 0;
  return Array.from({ length: k }, (_, id) => {
    const rows = labels.flatMap((label, i) => (label === id ? [i] : []));
    const centroid = Array.from({ length: width }, (_, j) => {
      const sum = rows.reduce((acc, i) => acc + (voteMatrix[i]?.[j] ?? 0), 0);
      return rows.length > 0 ? sum / rows.length : 0;
    });
    const ids = rows.map((i) => memberIds[i]).filter((m): m is string => m !== undefined);
    return { id, size: ids.length, centroid, memberIds: ids };
  }).filter((c) => c.size > 0);
}

// Distinct cluster labels in numeric order — the order every groupSupport
// array follows. (A bare .sort() compares as strings: [10, 2].)
function sortedGroupLabels(labels: number[]): number[] {
  return [...new Set(labels)].sort((a, b) => a - b);
}

/**
 * Consensus ranking (product of Laplace-smoothed per-group agree rates).
 * Propositions all groups agree on score highest. Sorted by score, descending.
 * A ranking, not a verdict: filter with isConsensus before calling a row
 * consensus.
 */
export function detectConsensus(
  voteMatrix: number[][],
  labels: number[],
  propositions: OpinionClusterProposition[],
): OpinionClusterConsensus[] {
  const uniqueLabels = sortedGroupLabels(labels);

  return propositions
    .map((prop, j) => {
      const groupSupport = uniqueLabels.map((label) => {
        const members = voteMatrix.filter((_, i) => labels[i] === label);
        const agree = members.filter((row) => row[j] === 1).length;
        return (1 + agree) / (2 + members.length); // Laplace smoothing
      });

      const score = groupSupport.reduce((acc, p) => acc * p, 1);

      return { propositionId: prop.id, text: prop.text, score, groupSupport };
    })
    .sort((a, b) => b.score - a.score);
}

// Minimum per-group support for a proposition to count as consensus.
const CONSENSUS_MIN_SUPPORT = 0.6;

/**
 * Whether a detectConsensus row is actually consensus: every group's support
 * is at least CONSENSUS_MIN_SUPPORT (with a single group, that group alone).
 * detectConsensus only ranks — by the product of the supports, with no
 * threshold — so a proposition the groups split on (support 0.97 / 0.09 / 0.96
 * / 0.40 / 0.10) could still top the list and be reported as consensus.
 * Same definition as the hosted app, which fixed the same symptom on
 * 2026-09-29 and filters both its stored output and its screen with it; the
 * CLI copy predated that fix. Callers reading saved runs filter with it too,
 * since runs written before this check still carry unfiltered rows.
 */
export function isConsensus(c: Pick<OpinionClusterConsensus, "groupSupport">): boolean {
  return c.groupSupport.length > 0 && c.groupSupport.every((p) => p >= CONSENSUS_MIN_SUPPORT);
}

/**
 * Division detection (max - min spread of per-group agree rates). Sorted by
 * spread, descending.
 */
export function detectDivision(
  voteMatrix: number[][],
  labels: number[],
  propositions: OpinionClusterProposition[],
): OpinionClusterDivisive[] {
  const uniqueLabels = sortedGroupLabels(labels);

  return propositions
    .map((prop, j) => {
      const groupSupport = uniqueLabels.map((label) => {
        const members = voteMatrix.filter((_, i) => labels[i] === label);
        const agree = members.filter((row) => row[j] === 1).length;
        return members.length > 0 ? agree / members.length : 0;
      });

      const spread = Math.max(...groupSupport) - Math.min(...groupSupport);

      return { propositionId: prop.id, text: prop.text, spread, groupSupport };
    })
    .sort((a, b) => b.spread - a.spread);
}

/**
 * Bridging propositions (support above BRIDGING_MIN_SUPPORT in every group).
 * bridgingScore = minGroupSupport * meanGroupSupport, descending, top TOP_PROPOSITIONS.
 */
export function computeBridging(
  voteMatrix: number[][],
  labels: number[],
  propositions: OpinionClusterProposition[],
): OpinionClusterBridging[] {
  const uniqueLabels = sortedGroupLabels(labels);

  const results = propositions.map((prop, j) => {
    const groupSupport = uniqueLabels.map((label) => {
      const members = voteMatrix.filter((_, i) => labels[i] === label);
      const agree = members.filter((row) => row[j] === 1).length;
      return members.length > 0 ? agree / members.length : 0;
    });

    const minGroupSupport = Math.min(...groupSupport);
    const meanGroupSupport = groupSupport.reduce((a, b) => a + b, 0) / groupSupport.length;
    const bridgingScore = minGroupSupport * meanGroupSupport;

    return {
      propositionId: prop.id,
      text: prop.text,
      bridgingScore,
      minGroupSupport,
      groupSupport,
    };
  });

  return results
    .filter((r) => r.minGroupSupport > BRIDGING_MIN_SUPPORT)
    .sort((a, b) => b.bridgingScore - a.bridgingScore)
    .slice(0, TOP_PROPOSITIONS);
}

/**
 * The n propositions with the largest |loading| on each of the first k
 * principal components — the material the axis-label stage names each axis
 * from (labelAxes).
 *
 * `loadings` is ml-pca's getLoadings(), which is Uᵀ: rows are principal
 * components, columns are propositions, so loadings[c][j] is the weight of
 * proposition j on component c.
 */
export function topPropositionsByAxis(
  propositions: { text: string }[],
  loadings: number[][],
  k: number,
  n = 3,
): { text: string; loading: number }[][] {
  return Array.from({ length: k }, (_, c) =>
    propositions
      .map((p, j) => ({ text: p.text, loading: loadings[c]?.[j] ?? 0 }))
      .sort((a, b) => Math.abs(b.loading) - Math.abs(a.loading))
      .slice(0, n),
  );
}

export type MinorityDivergence = {
  propositionId: string;
  text: string;
  minorityStance: number; // the minority cluster's centroid value
  overallStance: number; // size-weighted mean of all cluster centroids
};

/**
 * The minority report's numbers: the smallest cluster (first one on ties) and
 * the `top` propositions where its centroid is farthest from the size-weighted
 * overall centroid. null with fewer than two clusters. Computed here so the
 * model only interprets these numbers, never derives them.
 */
export function findMinorityDivergence(
  clusters: OpinionCluster[],
  propositions: OpinionClusterProposition[],
  top = 5,
): { cluster: OpinionCluster; divergences: MinorityDivergence[] } | null {
  if (clusters.length < 2) return null;
  const minority = clusters.reduce((min, c) => (c.size < min.size ? c : min));
  const totalSize = clusters.reduce((sum, c) => sum + c.size, 0);
  const divergences = propositions
    .map((p, j) => {
      const weighted = clusters.reduce((acc, c) => acc + (c.centroid[j] ?? 0) * c.size, 0);
      const overallStance = totalSize > 0 ? weighted / totalSize : 0;
      const minorityStance = minority.centroid[j] ?? 0;
      return { propositionId: p.id, text: p.text, minorityStance, overallStance };
    })
    .sort(
      (a, b) =>
        Math.abs(b.minorityStance - b.overallStance) - Math.abs(a.minorityStance - a.overallStance),
    )
    .slice(0, top);
  return { cluster: minority, divergences };
}
