// Live progress rendering for a run. Writes to stderr so stdout stays clean
// for the summary (and for piping). TTY gets an in-place bar with ETA;
// non-TTY (CI, redirects) gets sparse plain lines.

import type { RunProgressEvent, RunStageName } from "@wind-tunnel/core";
import { clip, displayWidth, formatDuration, paint, progressBar, useColor } from "./format";

const STAGE_LABELS: Record<RunStageName, string> = {
  filter: "sampling personas",
  react: "reactions",
  score: "scoring",
  verdict: "verdict",
  cluster: "clustering",
  suggest: "alternatives",
  export: "export",
};

export type ProgressRenderer = {
  onEvent: (event: RunProgressEvent) => void;
  finish: () => void;
};

export function createProgressRenderer(
  stream: NodeJS.WriteStream = process.stderr,
): ProgressRenderer {
  const tty = Boolean(stream.isTTY);
  const color = useColor(stream);
  let lineActive = false;
  let stageStart = Date.now();
  let lastPrintedPct = -1;

  const clearLine = () => {
    if (tty && lineActive) {
      stream.write("\r\u001B[2K");
      lineActive = false;
    }
  };

  const stageLine = (label: string) => {
    clearLine();
    stream.write(`${paint("bold", "▸", color)} ${label}\n`);
  };

  return {
    onEvent(event: RunProgressEvent) {
      if (event.type === "stage") {
        stageStart = Date.now();
        lastPrintedPct = -1;
        stageLine(STAGE_LABELS[event.stage]);
        return;
      }
      if (event.type === "warning") {
        clearLine();
        stream.write(`${paint("yellow", "⚠", color)} ${event.message}\n`);
        return;
      }
      if (event.type === "opinion") {
        // Live voice stream: each finished reaction scrolls past while the
        // progress bar stays pinned below (the paired progress event redraws
        // it right after). The wait becomes content.
        const a = event.opinion.attributes;
        const meta = clip(
          [a.age ? String(a.age) : "", a.occupation, a.location].filter(Boolean).join(" · "),
          28,
        );
        const text = clip(event.opinion.text, 76 - 2 - displayWidth(meta) - 2);
        clearLine();
        stream.write(`  ${paint("dim", meta, color)}  ${text}\n`);
        return;
      }
      if (event.type === "progress") {
        const { done, total } = event;
        const elapsed = Date.now() - stageStart;
        const eta = done > 0 ? (elapsed / done) * (total - done) : 0;
        if (tty) {
          const line = `  ${progressBar(done, total)}  ${done}/${total}  ${formatDuration(elapsed)}${
            done > 0 && done < total ? ` · ~${formatDuration(eta)} left` : ""
          }`;
          stream.write(`\r\u001B[2K${line}`);
          lineActive = true;
          if (done >= total) {
            stream.write("\n");
            lineActive = false;
          }
        } else {
          // Sparse: every 10% plus completion, one plain line each.
          const pct = Math.floor((done / total) * 10) * 10;
          if (pct !== lastPrintedPct || done >= total) {
            lastPrintedPct = pct;
            stream.write(`  ${done}/${total} (${formatDuration(elapsed)})\n`);
          }
        }
      }
      // "opinion" events carry data for other consumers; the bar already moves
      // via the paired progress event.
    },
    finish() {
      clearLine();
    },
  };
}
