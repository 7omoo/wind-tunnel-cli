// `wt-cli detail [run-id]` — the drill-down behind the summary's group cards:
// the proposition × group agreement table, then every voice in full, sorted
// most-critical first. Defaults to the latest run; `--group N` narrows to one
// group. Plain stdout, so `wt-cli detail | less` pages naturally.

import { classifySentiment, RunStore } from "@wind-tunnel/core";
import { clip, displayWidth, paint, useColor, wrap } from "../render/format";
import { GROUP_STYLES } from "../render/summary";
import { latestRunDir, resolveRunDir } from "../runs";

const SENTIMENT_STYLE = { critical: "red", neutral: "gray", favorable: "green" } as const;

// Stance percentage color: strong agreement green, strong disagreement red,
// the contested middle stays gray.
function stanceStyle(pct: number): Parameters<typeof paint>[0] {
  if (pct >= 65) return "green";
  if (pct <= 35) return "red";
  return "gray";
}

export async function detailCommand(
  idOrPath: string | undefined,
  opts: { group?: number },
): Promise<number> {
  const stdout = process.stdout;
  const color = useColor(stdout);
  const c = (style: Parameters<typeof paint>[0], text: string) => paint(style, text, color);
  const w = Math.max(56, (stdout.columns ?? 78) - 2);

  try {
    const dir = idOrPath ? await resolveRunDir(idOrPath) : await latestRunDir();
    const store = await RunStore.open(dir);
    const input = await store.readInput();
    const opinions = await store.readOpinions();
    const scores = (await store.readScores())?.scores ?? [];
    const cluster = (await store.readCluster()) ?? null;

    const out: string[] = [];
    out.push("");
    out.push(c("dim", "─".repeat(w)));
    out.push(c("bold", clip(input.topic, w)));
    out.push(c("dim", `${input.runId} · ${input.country} · ${opinions.length} voices`));
    out.push(c("dim", "─".repeat(w)));

    // Group legend + persona -> group lookup (colors match the summary cards).
    const groupOfPersona = new Map<string, number>(); // personaId -> profile index
    const groups = (cluster?.groupProfiles ?? []).map((g, gi) => {
      const cl = cluster?.clusters.find((x) => x.id === g.clusterId);
      for (const id of cl?.memberIds ?? []) groupOfPersona.set(id, gi);
      return {
        index: gi,
        name: g.name || `group ${gi + 1}`,
        size: cl?.size ?? 0,
        clusterId: g.clusterId,
        centroid: cl?.centroid ?? [],
        style: GROUP_STYLES[gi % GROUP_STYLES.length] ?? "cyan",
      };
    });

    if (opts.group !== undefined && (opts.group < 1 || opts.group > groups.length)) {
      throw new Error(`--group must be 1..${groups.length}`);
    }
    const filter = opts.group !== undefined ? groups[opts.group - 1] : undefined;

    if (groups.length > 0) {
      out.push("");
      out.push(
        groups
          .map((g) => `${c(g.style, "●")} ${g.index + 1} ${clip(g.name, 24)} (${g.size})`)
          .join("   "),
      );
    }

    // ── Proposition × group agreement table ──
    if (cluster && groups.length > 0 && cluster.propositions.length > 0 && !filter) {
      const cellW = 6;
      const labelW = Math.max(24, w - groups.length * cellW - 2);
      out.push("");
      out.push(c("bold", "Proposition × group agreement"));
      out.push(
        `  ${" ".repeat(labelW)}${groups
          .map((g) =>
            c(
              g.style,
              String(g.index + 1)
                .padStart(cellW - 1)
                .concat(" "),
            ),
          )
          .join("")}`,
      );
      const consensusIds = new Set((cluster.consensus ?? []).map((x) => x.propositionId));
      cluster.propositions.forEach((p, j) => {
        const marker = consensusIds.has(p.id) ? "≡ " : "  ";
        const label = clip(`${marker}${p.text}`, labelW - 1);
        const pad = " ".repeat(Math.max(0, labelW - displayWidth(label)));
        const cells = groups
          .map((g) => {
            const pct = Math.round((((g.centroid[j] ?? 0) + 1) / 2) * 100);
            return c(stanceStyle(pct), `${pct}%`.padStart(cellW - 1).concat(" "));
          })
          .join("");
        out.push(`  ${label}${pad}${cells}`);
      });
      out.push(c("dim", "  ≡ consensus proposition · % = group agreement"));
    }

    // ── Every voice, most critical first ──
    const scoreById = new Map(scores.map((s) => [s.personaId, s]));
    const list = opinions
      .map((o) => ({ opinion: o, score: scoreById.get(o.personaId) }))
      .filter((v) => !filter || groupOfPersona.get(v.opinion.personaId) === filter.index)
      .sort((a, b) => (a.score?.score ?? 0) - (b.score?.score ?? 0));

    out.push("");
    out.push(
      c(
        "bold",
        filter ? `Voices — ${clip(filter.name, 40)} (${list.length})` : `Voices (${list.length})`,
      ),
    );
    for (const { opinion, score } of list) {
      const gi = groupOfPersona.get(opinion.personaId);
      const dot = gi !== undefined ? c(GROUP_STYLES[gi % GROUP_STYLES.length] ?? "cyan", "●") : " ";
      const s = score?.score ?? 0;
      const scoreLabel = c(SENTIMENT_STYLE[classifySentiment(s)], String(s).padStart(4));
      const a = opinion.attributes;
      const meta = [a.age ? String(a.age) : "", a.occupation, a.location]
        .filter(Boolean)
        .join(" · ");
      out.push("");
      out.push(`${scoreLabel} ${dot} ${c("dim", clip(meta, w - 8))}`);
      out.push(...wrap(opinion.text, w - 6, "").map((l) => `      ${l}`));
      if (score?.reason) {
        out.push(...wrap(score.reason, w - 6, "").map((l) => c("dim", `      ${l}`)));
      }
    }
    out.push("");

    stdout.write(`${out.join("\n")}\n`);
    return 0;
  } catch (e) {
    process.stderr.write(
      `${paint("red", "✗", useColor(process.stderr))} ${e instanceof Error ? e.message : String(e)}\n`,
    );
    return 1;
  }
}
