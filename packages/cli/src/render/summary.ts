// Final terminal summary of a run — the part a user screenshots. Reads the
// artifacts, not intermediate state, so `run` and `resume` render identically.

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
import { clip, formatDuration, paint, useColor } from "./format";

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
  const rule = c("dim", "─".repeat(60));

  lines.push("");
  lines.push(rule);
  lines.push(c("bold", clip(data.input.topic, 58)));
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
    if (data.verdict.summary) lines.push(clip(data.verdict.summary, 240));
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
        `  ${i + 1}. "${clip(t.expression, 60)}" (${t.severity}) → ${clip(t.offendedSegment, 60)}`,
      );
    });
  }

  if (data.cluster?.groupProfiles?.length) {
    lines.push("");
    lines.push(c("bold", "Opinion groups"));
    for (const g of data.cluster.groupProfiles) {
      const size = data.cluster.clusters.find((cl) => cl.id === g.clusterId)?.size ?? 0;
      const name = g.name || `group ${g.clusterId + 1}`;
      lines.push(`  • ${name} (${size})${g.coreBelief ? ` — ${clip(g.coreBelief, 70)}` : ""}`);
    }
    if (data.cluster.axes?.length) {
      lines.push(
        c(
          "dim",
          `  axes: ${data.cluster.axes
            .slice(0, 2)
            .map((a) => `${a.label} (${a.variancePct}%)`)
            .join(" · ")}`,
        ),
      );
    }
  }

  if (data.suggest?.alternatives.length) {
    lines.push("");
    lines.push(c("bold", "Alternatives"));
    data.suggest.alternatives.forEach((a, i) => {
      lines.push(`  ${i + 1}. ${clip(a.text, 90)}`);
      lines.push(c("dim", `     ${a.strategy} · risk reduction ${a.estimatedRiskReduction}`));
    });
    if (data.suggest.commonGround) {
      lines.push(c("dim", `  common ground: ${clip(data.suggest.commonGround, 90)}`));
    }
  }

  if (data.warnings.length > 0) {
    lines.push("");
    for (const w of data.warnings) lines.push(`${c("yellow", "⚠")} ${w}`);
  }

  lines.push("");
  lines.push(c("dim", `artifacts: ${data.runDir}`));
  lines.push("");

  const text = lines.join("\n");
  stream.write(`${text}\n`);
  return text;
}
