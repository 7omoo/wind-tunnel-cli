// Suggest stage: alternative rewrites + common ground. One call on the premium
// model — the single "think hard once" step of the pipeline. Consumes the
// cluster analysis (consensus/division/bridging/profiles/minority) plus the
// verdict's triggers and safe version.

import { generateText, type LanguageModel, Output } from "ai";
import { z } from "zod";
import { outputLangName } from "../schemas";
import type {
  AlternativeSuggestions,
  FlameResult,
  OpinionClusterResult,
  OutputLang,
} from "../types";
import { escapeForPrompt, sanitizePromptInput } from "../util/sanitize";

const suggestGenSchema = z.object({
  alternatives: z
    .array(
      z.object({
        text: z.string(),
        strategy: z.string(),
        targetTriggers: z.array(z.number().int().min(0)),
        estimatedRiskReduction: z.enum(["High", "Medium", "Low"]),
        reasoning: z.string(),
      }),
    )
    .min(2)
    .max(4),
  commonGround: z.string(),
});

export type SuggestOptions = {
  topic: string;
  cluster: OpinionClusterResult;
  verdict: FlameResult;
  outputLang: OutputLang;
  model: LanguageModel;
};

export async function suggestAlternatives(opts: SuggestOptions): Promise<AlternativeSuggestions> {
  const topic = sanitizePromptInput(opts.topic);
  const ja = opts.outputLang === "ja";
  const lang = outputLangName(opts.outputLang);
  const none = ja ? "なし" : "None";
  const { cluster, verdict } = opts;

  // All cluster/verdict text is model-generated upstream — escape before
  // re-embedding (indirect prompt-injection defense).
  const consensusBlock =
    cluster.consensus
      .slice(0, 5)
      .map((c) => `- ${escapeForPrompt(c.text)} (${ja ? "合意度" : "agreement"}: ${c.score})`)
      .join("\n") || none;

  const divisiveBlock =
    cluster.divisive
      .slice(0, 5)
      .map((d) => `- ${escapeForPrompt(d.text)} (${ja ? "分断度" : "spread"}: ${d.spread})`)
      .join("\n") || none;

  const bridgingBlock =
    (cluster.bridging ?? [])
      .map(
        (b) =>
          `- ${escapeForPrompt(b.text)} (${ja ? "橋渡しスコア" : "bridging score"}: ${b.bridgingScore.toFixed(2)})`,
      )
      .join("\n") || none;

  const groupsBlock =
    (cluster.groupProfiles ?? [])
      .map((g) =>
        ja
          ? `【${escapeForPrompt(g.name)}】\n  信念: ${escapeForPrompt(g.coreBelief)}\n  価値観: ${g.keyValues.map((v) => escapeForPrompt(v)).join(", ")}\n  代表的発言: "${escapeForPrompt(g.representativeQuote)}"`
          : `[${escapeForPrompt(g.name)}]\n  Belief: ${escapeForPrompt(g.coreBelief)}\n  Values: ${g.keyValues.map((v) => escapeForPrompt(v)).join(", ")}\n  Quote: "${escapeForPrompt(g.representativeQuote)}"`,
      )
      .join("\n\n") || none;

  const minorityBlock = cluster.minorityReport
    ? `${escapeForPrompt(cluster.minorityReport.narrative)}\n${ja ? "盲点" : "Blind spots"}: ${cluster.minorityReport.blindSpots.map((s) => escapeForPrompt(s)).join(", ")}`
    : none;

  let flameBlock = "";
  if (verdict.triggers.length > 0) {
    const triggerLabel = ja ? "炎上トリガー" : "Backlash Triggers";
    // Indexed: targetTriggers in the output refers to these 0-based indexes.
    flameBlock += `\n=== ${triggerLabel} ===\n${verdict.triggers
      .map(
        (t, i) =>
          `[${i}] ${ja ? "「" : '"'}${escapeForPrompt(t.expression)}${ja ? "」" : '"'} (${t.severity}) → ${escapeForPrompt(t.offendedSegment)}`,
      )
      .join("\n")}`;
  }
  if (verdict.safeVersion) {
    flameBlock += `\n\n=== ${ja ? "現在の安全版" : "Current Safe Version"} ===\n${escapeForPrompt(verdict.safeVersion)}`;
  }

  const system = ja
    ? `あなたは多様な意見を統合し、全ステークホルダーが受け入れ可能な「落とし所」を設計する合意形成の専門家です。
以下の意見クラスタ分析データ（合意点・対立点・橋渡し命題・グループ像・少数派視点）に基づき、具体的かつ実行可能な表現アドバイスを生成してください。日本語で出力してください。`
    : `You are an expert consensus builder who integrates diverse opinions to design compromise positions acceptable to all stakeholders.
Based on the opinion-cluster analysis data below (consensus, divisive points, bridging propositions, group profiles, minority perspectives), generate specific and actionable phrasing advice. Output in ${lang}.`;

  const labels = ja
    ? {
        consensus: "合意事項",
        divisive: "対立事項",
        bridging: "ブリッジング（橋渡し）",
        groups: "グループプロフィール",
        minority: "マイノリティの視点",
      }
    : {
        consensus: "Points of Agreement",
        divisive: "Points of Division",
        bridging: "Bridging Statements",
        groups: "Group Profiles",
        minority: "Minority Perspectives",
      };

  const instructions = ja
    ? `指針:
- alternatives は 2-4 件。元の意図を保ったまま炎上リスクを下げる、コピペして即使える具体的な書き換え案
- targetTriggers は上記「炎上トリガー」の番号 ([0] 始まり) の配列。その案で消せるトリガーを指す。該当が無ければ空配列
- estimatedRiskReduction は High / Medium / Low の定性評価 (スコアの再計算はしない)
- 対立事項の語彙は避け、合意事項とブリッジング命題の語彙を活用。少数派の盲点にも配慮
- commonGround は全グループが共有する根本的な価値観を 1 文で`
    : `Guidance:
- alternatives: 2-4 rewrites that lower backlash risk while preserving the original intent — specific and copy-paste ready
- targetTriggers: array of 0-based indexes into "Backlash Triggers" above that the option removes; empty if none
- estimatedRiskReduction: qualitative High / Medium / Low (do NOT re-score)
- Avoid divisive vocabulary; use consensus and bridging vocabulary; mind the minority blind spots
- commonGround: the fundamental value all groups share, one sentence`;

  const { output } = await generateText({
    model: opts.model,
    temperature: 0.1,
    output: Output.object({ schema: suggestGenSchema }),
    system,
    prompt: `${ja ? "テーマ" : "Topic"}: ${topic}

=== ${labels.consensus} ===
${consensusBlock}

=== ${labels.divisive} ===
${divisiveBlock}

=== ${labels.bridging} ===
${bridgingBlock}

=== ${labels.groups} ===
${groupsBlock}

=== ${labels.minority} ===
${minorityBlock}${flameBlock}

${instructions}`,
  });

  const maxTrigger = verdict.triggers.length - 1;
  return {
    alternatives: output.alternatives.map((a, i) => ({
      id: `alt-${i + 1}`,
      text: a.text,
      strategy: a.strategy,
      // The schema can't know the trigger count; clamp out-of-range references.
      targetTriggers: a.targetTriggers.filter((t) => t >= 0 && t <= maxTrigger),
      estimatedRiskReduction: a.estimatedRiskReduction,
      reasoning: a.reasoning,
    })),
    commonGround: output.commonGround,
  };
}
