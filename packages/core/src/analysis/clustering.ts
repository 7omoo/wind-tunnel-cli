// Pure numeric functions for the vote-matrix opinion-cluster analysis.
// No LLM, network, or fs access — kept separate for testability.

import type {
  OpinionClusterBridging,
  OpinionClusterConsensus,
  OpinionClusterDivisive,
  OpinionClusterProposition,
} from "../types";

/**
 * Silhouette coefficient (for choosing k in k-means).
 * For each point: a = mean intra-cluster distance, b = mean distance to the
 * nearest other cluster; score = (b - a) / max(a, b), averaged over all points.
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
    const a = sameCount > 0 ? sameSum / sameCount : 0;

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

/**
 * Consensus detection (product of Laplace-smoothed per-group agree rates).
 * Propositions all groups agree on score highest. Sorted by score, descending.
 */
export function detectConsensus(
  voteMatrix: number[][],
  labels: number[],
  propositions: OpinionClusterProposition[],
): OpinionClusterConsensus[] {
  const uniqueLabels = [...new Set(labels)].sort();

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

/**
 * Division detection (max - min spread of per-group agree rates). Sorted by
 * spread, descending.
 */
export function detectDivision(
  voteMatrix: number[][],
  labels: number[],
  propositions: OpinionClusterProposition[],
): OpinionClusterDivisive[] {
  const uniqueLabels = [...new Set(labels)].sort();

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
 * Bridging propositions (min support > 0.3 in every group).
 * bridgingScore = minGroupSupport * meanGroupSupport, descending, top 5.
 */
export function computeBridging(
  voteMatrix: number[][],
  labels: number[],
  propositions: OpinionClusterProposition[],
): OpinionClusterBridging[] {
  const uniqueLabels = [...new Set(labels)].sort();

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
    .filter((r) => r.minGroupSupport > 0.3)
    .sort((a, b) => b.bridgingScore - a.bridgingScore)
    .slice(0, 5);
}
