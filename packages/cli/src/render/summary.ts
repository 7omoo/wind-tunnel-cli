// Final terminal summary of a run — the part a user screenshots. Reads the
// artifacts, not intermediate state, so `run` and `resume` render identically.
// All layout is display-width aware (CJK counts as 2 columns) and long prose
// wraps with hanging indents instead of overflowing 80-column terminals.

import {
  type AlternativeSuggestions,
  averageScore,
  type FlameResult,
  type OpinionClusterResult,
  type OpinionScore,
  percentages,
  type RiskLevel,
  type RunInput,
  sentimentCounts,
} from "@wind-tunnel/core";
import { clip, formatDuration, paint, useColor, wrap } from "./format";

const WIDTH = 76;

const RISK_STYLE: Record<RiskLevel, Parameters<typeof paint>[0]> = {
  Low: "green",
  Medium: "yellow",
  High: "red",
  Critical: ["red", "bold"],
};

export type SummaryData = {
  input: RunInput;
  runDir: string;
  elapsedMs: number;
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

  if (data.verdict) {
    const risk = data.verdict.riskLevel;
    lines.push("");
    lines.push(
      `${c("bold", "Backlash index")}  ${c(RISK_STYLE[risk], `${data.verdict.inflammationIndex} / 100  ${risk.toUpperCase()}`)}`,
    );
    if (data.verdict.summary) lines.push(...wrap(data.verdict.summary, WIDTH));
  }

  if (data.scores.length > 0) {
    const counts = sentimentCounts(data.scores);
    const pct = percentages(counts, data.scores.length);
    lines.push("");
    lines.push(
      `${c("bold", "Voices")}  ${c("red", `critical ${pct.critical}% (${counts.critical})`)} · neutral ${pct.neutral}% (${counts.neutral}) · ${c("green", `favorable ${pct.favorable}% (${counts.favorable})`)} · mean ${averageScore(data.scores)}`,
    );
  }

  if (data.verdict && data.verdict.triggers.length > 0) {
    lines.push("");
    lines.push(c("bold", "Triggers"));
    data.verdict.triggers.forEach((t, i) => {
      lines.push(
        ...wrap(
          `${i + 1}. "${t.expression}" (${t.severity}) → ${t.offendedSegment}`,
          WIDTH - 2,
          "   ",
        ).map((l, j) => (j === 0 ? `  ${l}` : `  ${l}`)),
      );
    });
  }

  if (data.cluster?.groupProfiles?.length) {
    lines.push("");
    lines.push(c("bold", "Opinion groups"));
    for (const g of data.cluster.groupProfiles) {
      const size = data.cluster.clusters.find((cl) => cl.id === g.clusterId)?.size ?? 0;
      const name = g.name || `group ${g.clusterId + 1}`;
      const body = `• ${name} (${size})${g.coreBelief ? ` — ${g.coreBelief}` : ""}`;
      // Continuation aligns under the text after the bullet.
      lines.push(...wrap(body, WIDTH - 2, "  ").map((l) => `  ${l}`));
    }
    if (data.cluster.axes?.length) {
      const axesText = `axes: ${data.cluster.axes
        .slice(0, 2)
        .map((a) => `${a.label} (${a.variancePct}%)`)
        .join(" · ")}`;
      lines.push(...wrap(axesText, WIDTH - 2, "  ").map((l) => c("dim", `  ${l}`)));
    }
  }

  if (data.suggest?.alternatives.length) {
    lines.push("");
    lines.push(c("bold", "Alternatives"));
    data.suggest.alternatives.forEach((a, i) => {
      // Continuation aligns under the text after the "N. " marker.
      lines.push(...wrap(`${i + 1}. ${a.text}`, WIDTH - 2, "   ").map((l) => `  ${l}`));
      lines.push(
        ...wrap(
          `${a.strategy} · risk reduction ${a.estimatedRiskReduction}`,
          WIDTH - 5,
          "     ",
        ).map((l) => c("dim", `     ${l}`)),
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
  lines.push(c("dim", `artifacts: ${data.runDir}`));
  lines.push("");

  const text = lines.join("\n");
  stream.write(`${text}\n`);
  return text;
}
