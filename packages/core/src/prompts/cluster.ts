// Prompts for the cluster stage (pipeline/cluster-stages.ts): proposition
// extraction, stance classification, axis labels, and group profiles with the
// minority report. The stage owns the generation schemas, the numbers and the
// failure handling; this module owns the wording.

import type { MinorityDivergence } from "../analysis/clustering";
import { outputLangName } from "../schemas";
import type { Opinion, OpinionCluster, OpinionClusterProposition, OutputLang } from "../types";
import { postContentBlock } from "./post";

type Prompts = { system: string; prompt: string };

// === Propositions (analysis model, one call on a sample) ===

export function propositionPrompts(opts: {
  topic: string;
  opinions: Opinion[];
  outputLang: OutputLang;
}): Prompts {
  const lang = outputLangName(opts.outputLang);
  const opinionsText = opts.opinions.map((o, i) => `${i + 1}. ${o.text}`).join("\n");
  return {
    system: `You are an expert in public opinion analysis. Extract specific propositions that can be voted on as agree/disagree from multiple opinions. Output the propositions in ${lang}.`,
    prompt: `Extract 10-15 specific propositions that can be answered with agree/disagree/neutral from the following ${opts.opinions.length} opinions.

${postContentBlock(opts.topic, false)}

Opinions:
${opinionsText}

Each proposition must:
- Be specific enough to answer with agree/disagree/neutral
- Be based on claims actually mentioned in the opinions
- Not overlap with other propositions`,
  };
}

// === Stance classification (bulk model, batched) ===

export function stancePrompts(
  propositions: OpinionClusterProposition[],
  batch: Opinion[],
): Prompts {
  const pCount = propositions.length;
  const propList = propositions.map((p, j) => `${j + 1}. ${p.text}`).join("\n");
  const opinionsBlock = batch.map((o, i) => `Opinion ${i + 1}: "${o.text}"`).join("\n");
  return {
    system:
      "You are a stance classifier. For each opinion, decide for every proposition whether the opinion agrees (1), disagrees (-1), or is neutral/unrelated (0).",
    prompt: `Propositions (${pCount}, in order):
${propList}

Opinions (${batch.length}, in order):
${opinionsBlock}

Return votes as one row per opinion (in the same order), each row containing one vote per proposition (in the same order).`,
  };
}

// === Axis labels (bulk model, one call for all k axes) ===

export function axisLabelPrompts(opts: {
  k: number;
  // Per axis, its highest-|loading| propositions.
  topByAxis: { text: string; loading: number }[][];
  outputLang: OutputLang;
}): Prompts {
  const lang = outputLangName(opts.outputLang);
  const axisBlocks = opts.topByAxis
    .map(
      (top, c) =>
        `PC${c + 1} top contributing propositions:\n${top
          .map((t) => `"${t.text}" (loading: ${t.loading.toFixed(3)})`)
          .join("\n")}`,
    )
    .join("\n\n");
  return {
    system: `You are an expert in public opinion analysis. Interpret the meaning of PCA axes. Output in ${lang}.`,
    prompt: `Below are ${opts.k} principal component axes, each with its highest-contributing propositions. For each axis, express the opposing dimensions it represents with a short ${lang} label of the form "AAA ←→ BBB".

${axisBlocks}

Return exactly ${opts.k} labels, in PC order.`,
  };
}

// === Group profiles + minority report (analysis model, one combined call) ===

// A centroid value (mean vote in -1..1) beyond this reads as agree/disagree in
// the group's stance pattern; inside it, neutral.
const CENTROID_STANCE_THRESHOLD = 0.3;

// Member opinions shown to the model per group when writing its profile.
const PROFILE_SAMPLE_OPINIONS = 15;

export function profilePrompts(opts: {
  clusters: OpinionCluster[];
  propositions: OpinionClusterProposition[];
  opinions: Opinion[];
  minority: { cluster: OpinionCluster; divergences: MinorityDivergence[] } | null;
  totalSize: number;
  outputLang: OutputLang;
}): Prompts {
  const { clusters, propositions, opinions, totalSize } = opts;
  const lang = outputLangName(opts.outputLang);
  const opinionMap = new Map(opinions.map((o) => [o.personaId, o.text]));
  const hasMinority = opts.minority !== null;
  const minCluster = opts.minority?.cluster ?? null;
  const divergences = opts.minority?.divergences ?? [];

  const groupBlocks = clusters
    .map((cluster, gi) => {
      const stanceDescription = propositions
        .map((p, j) => {
          const val = cluster.centroid[j] ?? 0;
          const stance =
            val > CENTROID_STANCE_THRESHOLD
              ? "agree"
              : val < -CENTROID_STANCE_THRESHOLD
                ? "disagree"
                : "neutral";
          return `- "${p.text}": ${stance} (${val.toFixed(2)})`;
        })
        .join("\n");
      const memberOpinions = cluster.memberIds
        .slice(0, PROFILE_SAMPLE_OPINIONS)
        .map((id) => opinionMap.get(id))
        .filter(Boolean)
        .map((t, i) => `${i + 1}. ${t}`)
        .join("\n");
      return `=== Group ${gi + 1} (size ${cluster.size}) ===\nStance pattern:\n${stanceDescription}\nSample opinions:\n${memberOpinions}`;
    })
    .join("\n\n");

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

  return {
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
  };
}
