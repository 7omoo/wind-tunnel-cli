// LLM stages of the opinion-cluster analysis. The numeric side (PCA, k-means,
// consensus detection) lives in analysis/clustering.ts and pipeline/cluster.ts;
// this module owns everything that talks to a model. All JSON returns through
// constrained decoding with strict generation schemas.

import { generateText, type LanguageModel, Output } from "ai";
import { z } from "zod";
import { stageTimeoutSignal } from "../models/stages";
import { outputLangName } from "../schemas";
import type {
  Opinion,
  OpinionClusterGroupProfile,
  OpinionClusterMinorityReport,
  OpinionClusterProposition,
  OutputLang,
} from "../types";
import { mapWaves } from "./batch";

export const STANCE_BATCH_SIZE = 10;

// === Propositions (analysis model, one call on a sample) ===

export async function extractPropositions(opts: {
  topic: string;
  opinions: Opinion[]; // pre-sampled by the caller
  outputLang: OutputLang;
  model: LanguageModel;
}): Promise<OpinionClusterProposition[]> {
  const lang = outputLangName(opts.outputLang);
  const schema = z.object({
    propositions: z
      .array(z.object({ text: z.string() }))
      .min(3)
      .max(15),
  });
  const opinionsText = opts.opinions.map((o, i) => `${i + 1}. ${o.text}`).join("\n");
  const { output } = await generateText({
    model: opts.model,
    temperature: 0.1,
    abortSignal: stageTimeoutSignal("propositions"),
    output: Output.object({ schema }),
    system: `You are an expert in public opinion analysis. Extract specific propositions that can be voted on as agree/disagree from multiple opinions. Output the propositions in ${lang}.`,
    prompt: `Extract 10-15 specific propositions that can be answered with agree/disagree/neutral from the following ${opts.opinions.length} opinions.

Topic: ${opts.topic}

Opinions:
${opinionsText}

Each proposition must:
- Be specific enough to answer with agree/disagree/neutral
- Be based on claims actually mentioned in the opinions
- Not overlap with other propositions`,
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
  const batches: Opinion[][] = [];
  for (let i = 0; i < opts.opinions.length; i += batchSize) {
    batches.push(opts.opinions.slice(i, i + batchSize));
  }
  const propList = opts.propositions.map((p, j) => `${j + 1}. ${p.text}`).join("\n");
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
      const opinionsBlock = batch.map((o, i) => `Opinion ${i + 1}: "${o.text}"`).join("\n");
      const { output } = await generateText({
        model: opts.model,
        temperature: 0.1,
        abortSignal: stageTimeoutSignal("stance"),
        output: Output.object({ schema }),
        system:
          "You are a stance classifier. For each opinion, decide for every proposition whether the opinion agrees (1), disagrees (-1), or is neutral/unrelated (0).",
        prompt: `Propositions (${pCount}, in order):
${propList}

Opinions (${batch.length}, in order):
${opinionsBlock}

Return votes as one row per opinion (in the same order), each row containing one vote per proposition (in the same order).`,
      });
      return output.votes;
    },
    opts.onProgress,
  );

  const voteMatrix: number[][] = [];
  const warnings: string[] = [];
  settled.forEach((result, i) => {
    if (result.status === "fulfilled") {
      voteMatrix.push(...result.value);
    } else {
      // A failed batch degrades to all-neutral rows (the original behavior);
      // reported so a run summary can show classification coverage.
      const batch = batches[i] ?? [];
      for (const _ of batch) voteMatrix.push(new Array<number>(pCount).fill(0));
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
      warnings.push(`stance batch ${i + 1}/${batches.length} failed (rows neutral): ${reason}`);
    }
  });
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
  const lang = outputLangName(opts.outputLang);
  const axisBlocks = topByAxis
    .map(
      (top, c) =>
        `PC${c + 1} top contributing propositions:\n${top
          .map((t) => `"${t.text}" (loading: ${t.loading.toFixed(3)})`)
          .join("\n")}`,
    )
    .join("\n\n");
  try {
    const schema = z.object({ labels: z.array(z.string()).length(opts.k) });
    const { output } = await generateText({
      model: opts.model,
      temperature: 0.1,
      abortSignal: stageTimeoutSignal("axis_labels"),
      output: Output.object({ schema }),
      system: `You are an expert in public opinion analysis. Interpret the meaning of PCA axes. Output in ${lang}.`,
      prompt: `Below are ${opts.k} principal component axes, each with its highest-contributing propositions. For each axis, express the opposing dimensions it represents with a short ${lang} label of the form "AAA ←→ BBB".

${axisBlocks}

Return exactly ${opts.k} labels, in PC order.`,
    });
    return fallback.map((fb, i) => output.labels[i] || fb);
  } catch {
    return fallback; // labels are cosmetic — the map still works as PC1..PCk
  }
}

// === Group profiles + minority report (analysis model, one combined call) ===

export async function generateGroupProfilesAndMinority(opts: {
  clusters: { id: number; size: number; centroid: number[]; memberIds: string[] }[];
  propositions: OpinionClusterProposition[];
  opinions: Opinion[];
  outputLang: OutputLang;
  model: LanguageModel;
}): Promise<{
  groupProfiles: OpinionClusterGroupProfile[];
  minorityReport: OpinionClusterMinorityReport | null;
  warnings: string[];
}> {
  const { clusters, propositions, opinions } = opts;
  const lang = outputLangName(opts.outputLang);
  const opinionMap = new Map(opinions.map((o) => [o.personaId, o.text]));

  const groupBlocks = clusters
    .map((cluster, gi) => {
      const stanceDescription = propositions
        .map((p, j) => {
          const val = cluster.centroid[j] ?? 0;
          const stance = val > 0.3 ? "agree" : val < -0.3 ? "disagree" : "neutral";
          return `- "${p.text}": ${stance} (${val.toFixed(2)})`;
        })
        .join("\n");
      const memberOpinions = cluster.memberIds
        .slice(0, 15)
        .map((id) => opinionMap.get(id))
        .filter(Boolean)
        .map((t, i) => `${i + 1}. ${t}`)
        .join("\n");
      return `=== Group ${gi + 1} (size ${cluster.size}) ===\nStance pattern:\n${stanceDescription}\nSample opinions:\n${memberOpinions}`;
    })
    .join("\n\n");

  // Minority divergence is computed numerically before the call; the model only
  // interprets it (never re-derives the numbers).
  const hasMinority = clusters.length >= 2;
  const minCluster = hasMinority
    ? clusters.reduce((min, c) => (c.size < min.size ? c : min))
    : null;
  const totalSize = clusters.reduce((sum, c) => sum + c.size, 0);
  const divergences =
    hasMinority && minCluster
      ? (() => {
          const overallCentroid = propositions.map((_, j) => {
            const sum = clusters.reduce((acc, c) => acc + (c.centroid[j] ?? 0) * c.size, 0);
            return totalSize > 0 ? sum / totalSize : 0;
          });
          return propositions
            .map((p, j) => ({
              propositionId: p.id,
              text: p.text,
              minorityStance: minCluster.centroid[j] ?? 0,
              overallStance: overallCentroid[j] ?? 0,
              diff: Math.abs((minCluster.centroid[j] ?? 0) - (overallCentroid[j] ?? 0)),
            }))
            .sort((a, b) => b.diff - a.diff)
            .slice(0, 5);
        })()
      : [];

  const minIndex = minCluster ? clusters.findIndex((c) => c.id === minCluster.id) : -1;
  const divergenceText = divergences
    .map(
      (d) =>
        `- "${d.text}": minority=${d.minorityStance.toFixed(2)}, overall=${d.overallStance.toFixed(2)}`,
    )
    .join("\n");
  const minorityBlock =
    hasMinority && minCluster
      ? `\n\n=== Minority divergence ===\nA minority group (Group ${minIndex + 1}, ${minCluster.size} of ${totalSize} people) diverges most from the overall on:\n${divergenceText}`
      : "";

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
      temperature: 0.1,
      abortSignal: stageTimeoutSignal("profiles"),
      output: Output.object({ schema }),
      system: `You are an expert in opinion group analysis${hasMinority ? " and minority blind-spot analysis" : ""}. Profile each opinion group independently${hasMinority ? ", then surface what the majority overlooks about the minority" : ""}. Output in ${lang}.`,
      prompt: `Analyze each opinion group below and create a profile for each.${hasMinority ? " Then write a minority report." : ""}

${groupBlocks}${minorityBlock}

Rules:
- name: a vivid 2-4 word ${lang} label for the camp — NEVER a generic label like "Group 1"
- coreBelief: exactly one sentence${clusters.length >= 2 ? ", emphasizing what DISTINGUISHES this group from the others" : ""}${
        hasMinority
          ? `
- minority.narrative: AT MOST 2 sentences
- minority.blindSpots: 1-3 items, each ONE short sentence`
          : ""
      }

Return exactly ${clusters.length} group profiles, in the SAME ORDER as the groups listed above.`,
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
      topDivergences: divergences.map((d) => ({
        propositionId: d.propositionId,
        text: d.text,
        minorityStance: d.minorityStance,
        overallStance: d.overallStance,
      })),
    };
  }

  return { groupProfiles, minorityReport, warnings };
}
