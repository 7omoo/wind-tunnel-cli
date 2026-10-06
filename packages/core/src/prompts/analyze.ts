// Prompts for the analyze stage (pipeline/analyze.ts): per-opinion scoring on
// the bulk model, then the verdict on the analysis model. The stage owns the
// generation schemas and the logic; this module owns the wording.

import { percentages, type SentimentCounts } from "../analysis/scoring";
import type { ScoredOpinion } from "../pipeline/sample";
import { outputLangName } from "../schemas";
import type { Opinion, OutputLang } from "../types";
import { postContentBlock } from "./post";

// === Scoring (bulk model, batched) ===

// Calibration ("boredom is not backlash"): dismissive/bored/pointless
// reactions are neutral, not critical; without that, harmless-but-bland posts
// saturate the verdict (observed: a weather question at 95/100 HIGH).
export function scoreSystemPrompt(outputLang: OutputLang): string {
  const lang = outputLangName(outputLang);
  return `You are a sentiment scorer for public reactions to a post/ad. For EVERY reaction, classify its stance toward the post and rate the intensity, with a one-sentence reason in ${lang}.
- stance "critical": the reaction criticizes, objects to, or is offended by the post
- stance "neutral": indifferent, bored, ambivalent, or "this is pointless" — dismissiveness is NOT criticism
- stance "favorable": the reaction approves of or supports the post
- intensity 20-100: how strongly the stance is expressed (mild 20-50, strong 60-100; ignored for neutral)`;
}

// Reactions are numbered; the answer is one entry per reaction in the same
// order (persona ids never reach the model — the stage maps by position).
export function scoreUserPrompt(topic: string, batch: Opinion[]): string {
  const reactionsBlock = batch.map((o, i) => `Reaction ${i + 1}: ${o.text}`).join("\n");
  return `${postContentBlock(topic, false)}\n\nReactions (${batch.length}, in order):\n${reactionsBlock}\n\nScore every reaction: one entry per reaction, in the same order.`;
}

// === Verdict (analysis model, one call on a budgeted sample) ===

export type VerdictPromptInput = {
  topic: string;
  outputLang: OutputLang;
  // Aggregate over every scored reaction, not just the sample.
  stats: { total: number; counts: SentimentCounts; average: number };
  opinionCount: number;
  sample: ScoredOpinion[]; // sorted by score ascending
  maxSampleIds: number; // cap on sampleOpinionIds per trigger
};

export function verdictPrompts(opts: VerdictPromptInput): { system: string; prompt: string } {
  const ja = opts.outputLang === "ja";
  const { total, counts, average: avg } = opts.stats;
  const pct = percentages(counts, total);
  const statsBlock = ja
    ? `全 ${total} 件の反応の集計: 批判的 ${counts.critical} 件 (${pct.critical}%) / 中立 ${counts.neutral} 件 (${pct.neutral}%) / 好意的 ${counts.favorable} 件 (${pct.favorable}%)。平均スコア ${avg} (-100〜+100)。`
    : `Aggregate over all ${total} reactions: critical ${counts.critical} (${pct.critical}%), neutral ${counts.neutral} (${pct.neutral}%), favorable ${counts.favorable} (${pct.favorable}%). Mean score ${avg} on -100..+100.`;
  const sampleNote =
    opts.sample.length < opts.opinionCount
      ? ja
        ? `以下は全 ${opts.opinionCount} 件から層化抽出した ${opts.sample.length} 件 (批判的な端・好意的な端を重点、スコア昇順)。`
        : `Below is a stratified sample of ${opts.sample.length} out of ${opts.opinionCount} reactions (weighted toward both extremes, sorted by score ascending).`
      : ja
        ? `以下は全 ${opts.sample.length} 件の反応 (スコア昇順)。`
        : `Below are all ${opts.sample.length} reactions (sorted by score ascending).`;

  const reactionsBlock = opts.sample
    .map((s) => `[${s.opinion.personaId}] (score ${s.score}) ${s.opinion.text}`)
    .join("\n");

  const system = ja
    ? `あなたは炎上リスク分析の専門家です。投稿・広告文への反応から炎上リスクを評価します。すべて日本語で出力してください。`
    : `You are an expert in backlash risk analysis. Assess the risk of public backlash from reactions to a post/ad. Output everything in ${outputLangName(opts.outputLang)}.`;
  const instructions = ja
    ? `評価の指針:
- inflammationIndex: 0-100 の炎上指数 (0=安全、100=炎上確実)。集計統計と反応の内容の両方を根拠にすること
- 炎上とは「怒り・不快感・道徳的反発が拡散する」ことである。反応の大半が無関心・退屈・「意味がない」という冷めた評価で、誰も傷つけず怒らせてもいないなら、批判的な反応が多くても指数は低く (25 以下に) すること。退屈は炎上ではない
- triggers: 何が・誰を不快にさせるか。実際に感情的・道徳的な反発を起こしている表現だけを挙げること (単に「つまらない」と言われた表現は trigger ではない)。expression は問題の表現、offendedSegment は不快に感じる層、count はその表現に反発している反応のおおよその件数、sampleOpinionIds は根拠となる代表的な反応の personaId を最大 ${opts.maxSampleIds} 件 (該当する反応をすべて挙げないこと。件数は count で表す)
- safeVersion: 元の意図を保ちつつ炎上リスクを下げた修正版`
    : `Guidance:
- inflammationIndex: 0-100 backlash index (0=safe, 100=certain backlash), grounded in both the aggregate statistics and the reactions
- Backlash means spreading anger, offense, or moral objection. If most reactions are indifference, boredom, or "this is pointless" — with nobody actually offended — the index must stay low (25 or less) even when many reactions are negative. Boring is not backlash
- triggers: what offends whom — only wording that provokes genuine emotional or moral pushback (being called dull does not make an expression a trigger). expression = the problematic wording, offendedSegment = who it offends, count = roughly how many reactions object to it, sampleOpinionIds = personaIds of at most ${opts.maxSampleIds} representative supporting reactions (not every matching reaction — count carries the number)
- safeVersion: a revision that preserves the original intent while lowering the risk`;

  return {
    system,
    prompt: `${postContentBlock(opts.topic, ja)}\n\n${statsBlock}\n\n${sampleNote}\n${reactionsBlock}\n\n${instructions}`,
  };
}
