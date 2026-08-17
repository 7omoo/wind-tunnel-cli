// Final terminal summary of a run — designed as a reply, not a report: the
// overall temperature first, what triggers whom, then the opinion groups as
// the centerpiece (each speaking through a real member voice), the minority's
// view, and the rewrites. Individual voices in full live behind `wt-cli
// detail`. Reads artifacts only, so `run` and `resume` render identically.
// Layout is display-width aware (CJK = 2 columns) and follows the terminal.

import {
  type AlternativeSuggestions,
  averageScore,
  type FlameResult,
  type Opinion,
  type OpinionClusterResult,
  type OpinionScore,
  percentages,
  type RiskLevel,
  type RunInput,
  sentimentCounts,
} from "@wind-tunnel/core";
import {
  clip,
  formatDuration,
  gauge,
  paint,
  segmentedBar,
  useColor,
  wrap,
  wrapLines,
} from "./format";

const RISK_STYLE: Record<RiskLevel, Parameters<typeof paint>[0]> = {
  Low: "green",
  Medium: "yellow",
  High: "red",
  Critical: ["red", "bold"],
};

// Group accents cycle through distinct colors, shared with `detail`.
export const GROUP_STYLES: Parameters<typeof paint>[0][] = [
  "cyan",
  "magenta",
  "yellow",
  "blue",
  "green",
];

// First sentence of the verdict prose — the group cards carry the substance,
// so the long summary paragraph compresses to its opening claim.
export function firstSentence(text: string): string {
  return text.match(/^[^。.!?！？]*[。.!?！？]/)?.[0]?.trim() ?? clip(text, 120);
}

// Pick up to two member voices for a group card: the most typical one (score
// closest to the group mean) and, when the group has spread, the loudest
// dissent from that mean. Real reactions ground the LLM-written belief line.
export function pickGroupVoices(
  memberIds: string[],
  opinions: Opinion[],
  scores: OpinionScore[],
  max = 2,
): { opinion: Opinion; score: number }[] {
  const opinionById = new Map(opinions.map((o) => [o.personaId, o]));
  const scoreById = new Map(scores.map((s) => [s.personaId, s.score]));
  const members = memberIds
    .map((id) => {
      const opinion = opinionById.get(id);
      return opinion ? { opinion, score: scoreById.get(id) ?? 0 } : null;
    })
    .filter((m): m is { opinion: Opinion; score: number } => m !== null && !!m.opinion.text);
  if (members.length === 0) return [];
  const mean = members.reduce((sum, m) => sum + m.score, 0) / members.length;
  const typical = [...members].sort(
    (a, b) => Math.abs(a.score - mean) - Math.abs(b.score - mean),
  )[0]!;
  const picked = [typical];
  if (members.length > 1 && max > 1) {
    const contrast = [...members]
      .filter((m) => m.opinion.personaId !== typical.opinion.personaId)
      .sort((a, b) => Math.abs(b.score - mean) - Math.abs(a.score - mean))[0];
    if (contrast) picked.push(contrast);
  }
  return picked.slice(0, max);
}

function voiceAttribution(opinion: Opinion): string {
  const a = opinion.attributes;
  return [a.age ? String(a.age) : "", a.occupation, a.location].filter(Boolean).join(" · ");
}

export type SummaryData = {
  input: RunInput;
  runDir: string;
  elapsedMs: number;
  opinions: Opinion[];
  scores: OpinionScore[];
  verdict: FlameResult | null;
  cluster: OpinionClusterResult | null;
  suggest: AlternativeSuggestions | null;
  warnings: string[];
};

export function renderSummary(
  data: SummaryData,
  stream: NodeJS.WriteStream = process.stdout,
): string {
  // Follow the terminal width (user decision 2026-08-17: no readability cap —
  // the terminal's own width is the measure).
  const WIDTH = Math.max(56, (stream.columns ?? 78) - 2);
  const color = useColor(stream);
  const c = (style: Parameters<typeof paint>[0], text: string) => paint(style, text, color);
  const lines: string[] = [];
  const rule = c("dim", "─".repeat(WIDTH));

  lines.push("");
  lines.push(rule);
  lines.push(c("bold", clip(data.input.topic, WIDTH)));
  lines.push(
    c(
      "dim",
      `${data.input.country} · ${data.input.filter.personaCount} personas · ${data.input.situation} · ${formatDuration(data.elapsedMs)}`,
    ),
  );
  lines.push(rule);

  // ── Temperature: index gauge + voice split, then one verdict sentence ──
  if (data.verdict) {
    const risk = data.verdict.riskLevel;
    lines.push("");
    lines.push(
      `${c("bold", "Backlash index")}  ${gauge(data.verdict.inflammationIndex, 100, 24, RISK_STYLE[risk], color)}  ${c(RISK_STYLE[risk], `${data.verdict.inflammationIndex} / 100  ${risk.toUpperCase()}`)}`,
    );
  }
  if (data.scores.length > 0) {
    const counts = sentimentCounts(data.scores);
    const pct = percentages(counts, data.scores.length);
    lines.push(
      `${c("bold", "Voices")}          ${segmentedBar(
        [
          { count: counts.critical, style: "red" },
          { count: counts.neutral, style: "gray" },
          { count: counts.favorable, style: "green" },
        ],
        24,
        color,
      )}  ${c("red", `critical ${pct.critical}% (${counts.critical})`)} · ${c("gray", `neutral ${pct.neutral}%`)} · ${c("green", `favorable ${pct.favorable}% (${counts.favorable})`)} · mean ${averageScore(data.scores)}`,
    );
  }
  if (data.verdict?.summary) {
    lines.push(...wrap(firstSentence(data.verdict.summary), WIDTH).map((l) => c("dim", l)));
  }

  // ── Triggers: what offends whom ──
  if (data.verdict && data.verdict.triggers.length > 0) {
    lines.push("");
    lines.push(c("bold", "Triggers"));
    data.verdict.triggers.forEach((t, i) => {
      lines.push(
        ...wrap(
          `${i + 1}. "${t.expression}" (${t.severity}) → ${t.offendedSegment}`,
          WIDTH - 2,
          "   ",
        ).map((l) => `  ${l}`),
      );
    });
  }

  // ── Opinion groups: the centerpiece — each group speaks ──
  if (data.cluster?.groupProfiles?.length) {
    const maxSize = Math.max(1, ...data.cluster.clusters.map((cl) => cl.size));
    data.cluster.groupProfiles.forEach((g, gi) => {
      const cluster = data.cluster?.clusters.find((cl) => cl.id === g.clusterId);
      const size = cluster?.size ?? 0;
      const name = g.name || `group ${gi + 1}`;
      const style = GROUP_STYLES[gi % GROUP_STYLES.length] ?? "cyan";
      const bar = paint(style, "█".repeat(Math.max(1, Math.round((size / maxSize) * 16))), color);

      lines.push("");
      lines.push(`${c(style, "◆")} ${c("bold", clip(name, WIDTH - 24))} (${size})  ${bar}`);
      if (g.coreBelief) {
        lines.push(...wrap(g.coreBelief, WIDTH - 2).map((l) => `  ${l}`));
      }
      if (g.keyValues.length > 0) {
        lines.push(c("dim", `  ${clip(g.keyValues.join(" · "), WIDTH - 2)}`));
      }
      // Real member voices ground the belief line (clamped to two lines each).
      const voices = pickGroupVoices(cluster?.memberIds ?? [], data.opinions, data.scores);
      for (const v of voices) {
        lines.push(...wrapLines(`「${v.opinion.text}」`, WIDTH - 2, "   ", 2).map((l) => `  ${l}`));
        lines.push(c("dim", `    — ${clip(voiceAttribution(v.opinion), WIDTH - 6)}`));
      }
    });
    if (data.cluster.axes?.length) {
      const axesText = `axes: ${data.cluster.axes
        .slice(0, 2)
        .map((a) => `${a.label} (${a.variancePct}%)`)
        .join(" · ")}`;
      lines.push("");
      lines.push(...wrap(axesText, WIDTH - 2, "  ").map((l) => c("dim", `  ${l}`)));
    }
  }

  // ── Minority view: what the majority overlooks ──
  const minority = data.cluster?.minorityReport;
  if (minority && (minority.narrative || minority.blindSpots.length > 0)) {
    const profile = data.cluster?.groupProfiles?.find((g) => g.clusterId === minority.clusterId);
    const gi = data.cluster?.groupProfiles?.findIndex((g) => g.clusterId === minority.clusterId);
    const style = GROUP_STYLES[(gi ?? 0) % GROUP_STYLES.length] ?? "cyan";
    const label = profile?.name || `group ${minority.clusterId + 1}`;
    lines.push("");
    lines.push(
      `${c(style, "▣")} ${c("bold", "Minority view")} — ${clip(label, 40)} (${minority.clusterSize}/${minority.totalSize})`,
    );
    if (minority.narrative) {
      lines.push(...wrap(minority.narrative, WIDTH - 2).map((l) => `  ${l}`));
    }
    if (minority.blindSpots.length > 0) {
      lines.push(
        ...wrap(`blind spots: ${minority.blindSpots.join(" · ")}`, WIDTH - 2, "  ").map((l) =>
          c("dim", `  ${l}`),
        ),
      );
    }
  }

  // ── Alternatives ──
  if (data.suggest?.alternatives.length) {
    lines.push("");
    lines.push(c("bold", "Alternatives"));
    data.suggest.alternatives.forEach((a, i) => {
      lines.push(...wrap(`${i + 1}. ${a.text}`, WIDTH - 2, "   ").map((l) => `  ${l}`));
      lines.push(
        ...wrap(`${a.strategy} · risk reduction ${a.estimatedRiskReduction}`, WIDTH - 5).map((l) =>
          c("dim", `     ${l}`),
        ),
      );
    });
    if (data.suggest.commonGround) {
      lines.push(
        ...wrap(`common ground: ${data.suggest.commonGround}`, WIDTH - 2, "  ").map((l) =>
          c("dim", `  ${l}`),
        ),
      );
    }
  }

  if (data.warnings.length > 0) {
    lines.push("");
    for (const w of data.warnings) {
      lines.push(
        ...wrap(w, WIDTH - 2, "  ").map((l, j) => (j === 0 ? `${c("yellow", "⚠")} ${l}` : l)),
      );
    }
  }

  lines.push("");
  lines.push(c("dim", `every voice: wt-cli detail ${data.input.runId}`));
  lines.push(c("dim", `artifacts: ${data.runDir}`));
  lines.push("");

  const text = lines.join("\n");
  stream.write(`${text}\n`);
  return text;
}
