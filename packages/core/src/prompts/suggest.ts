// Prompt for the suggest stage (pipeline/suggest.ts): one premium-model call
// that turns the cluster analysis and the verdict into rewrite options. The
// stage owns the schema and the trigger-index clamping; this module the wording.

import { outputLangName } from "../schemas";
import type { FlameResult, OpinionClusterResult, OutputLang } from "../types";
import { escapeForPrompt } from "../util/sanitize";
import { postContentBlock } from "./post";

export type SuggestPromptInput = {
  topic: string;
  cluster: OpinionClusterResult;
  verdict: FlameResult;
  outputLang: OutputLang;
};

export function suggestPrompts(opts: SuggestPromptInput): { system: string; prompt: string } {
  const ja = opts.outputLang === "ja";
  const lang = outputLangName(opts.outputLang);
  const none = ja ? "なし" : "None";
  const { cluster, verdict, topic } = opts;

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

  return {
    system,
    prompt: `${postContentBlock(topic, ja)}

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
  };
}
