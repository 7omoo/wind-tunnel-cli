// Live progress rendering for a run. Writes to stderr so stdout stays clean
// for the summary (and for piping).
//
// TTY mode draws an in-place block that is erased and redrawn on every update,
// so nothing accumulates in the scrollback:
//
//   ▸ reactions  ⠸ 48s
//     64 · 政治・経済・文化団体 · 東京都
//       週休3日の導入は働き方改革の一環として意義があると思うけど…
//     (…last 3 voices…)
//     ██████░░░░░░░░░░  6/20 · ~2m left
//
// When a stage completes, the block collapses to a single "✓ label 55s" line.
// Every stage header carries a spinner + elapsed time, so single-call stages
// (verdict, suggest) never look frozen, and single-batch bars (1/1) are not
// drawn at all. Line widths follow the terminal; every drawn line is clipped
// pre-paint so the erase arithmetic can never be broken by soft wrapping.
//
// Non-TTY (CI, redirects) falls back to plain lines: stage start/finish
// markers with durations, a sampled subset of voices, and sparse percentages.

import type { Opinion, RunProgressEvent, RunStageName } from "@wind-tunnel/core";
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

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const VOICE_WINDOW = 3;
const SPINNER_INTERVAL_MS = 120;

export type ProgressRenderer = {
  onEvent: (event: RunProgressEvent) => void;
  finish: () => void;
};

function voiceMeta(opinion: Opinion): string {
  const a = opinion.attributes;
  return [a.age ? String(a.age) : "", a.occupation, a.location].filter(Boolean).join(" · ");
}

export function createProgressRenderer(
  stream: NodeJS.WriteStream = process.stderr,
): ProgressRenderer {
  const tty = Boolean(stream.isTTY);
  const color = useColor(stream);

  let stage: RunStageName | null = null;
  let stageStart = 0;
  let spinnerIdx = 0;
  let bar: { done: number; total: number } | null = null;
  let voices: Opinion[] = [];
  let voicesSeen = 0;
  let lastPct = -1;
  let blockLines = 0;
  let timer: NodeJS.Timeout | undefined;

  // Re-read every render so window resizes are picked up.
  const cols = () => Math.max(40, stream.columns ?? 78);

  const erase = () => {
    if (!tty || blockLines === 0) return;
    stream.write(`\r\u001B[2K${"\u001B[1A\u001B[2K".repeat(blockLines - 1)}`);
    blockLines = 0;
  };

  const render = () => {
    if (!tty || stage === null) return;
    erase();
    const w = cols();
    const elapsed = Date.now() - stageStart;
    const spin = SPINNER[spinnerIdx % SPINNER.length] ?? "⠋";
    const lines: string[] = [
      `${paint("bold", "▸", color)} ${STAGE_LABELS[stage]}  ${paint("cyan", spin, color)} ${paint("dim", formatDuration(elapsed), color)}`,
    ];
    // Last few voices, two lines each: dimmed persona meta, then the reaction.
    for (const opinion of voices) {
      lines.push(`  ${paint("dim", clip(voiceMeta(opinion), w - 4), color)}`);
      lines.push(`    ${clip(opinion.text, w - 6)}`);
    }
    // A bar only when there is a real series to show (1/1 bars carry nothing
    // the spinner doesn't already say).
    if (bar && bar.total > 1) {
      const barWidth = Math.max(10, Math.min(24, w - 36));
      const eta =
        bar.done > 0 && bar.done < bar.total
          ? ` · ~${formatDuration((elapsed / bar.done) * (bar.total - bar.done))} left`
          : "";
      lines.push(
        `  ${progressBar(bar.done, bar.total, barWidth)}  ${bar.done}/${bar.total}${paint("dim", eta, color)}`,
      );
    }
    stream.write(lines.join("\n"));
    blockLines = lines.length;
  };

  // Collapse the live block into a single completed-stage line.
  const finalizeStage = () => {
    if (stage === null) return;
    const duration = formatDuration(Date.now() - stageStart);
    const line = `${paint("green", "✓", color)} ${STAGE_LABELS[stage]} ${paint("dim", duration, color)}\n`;
    if (tty) {
      erase();
      stream.write(line);
    } else {
      stream.write(line);
    }
    stage = null;
    voices = [];
    bar = null;
  };

  return {
    onEvent(event: RunProgressEvent) {
      if (event.type === "stage") {
        finalizeStage();
        stage = event.stage;
        stageStart = Date.now();
        voicesSeen = 0;
        lastPct = -1;
        if (tty) {
          if (!timer) {
            timer = setInterval(() => {
              spinnerIdx++;
              render();
            }, SPINNER_INTERVAL_MS);
            timer.unref();
          }
          render();
        } else {
          stream.write(`${paint("bold", "▸", color)} ${STAGE_LABELS[event.stage]}\n`);
        }
        return;
      }
      if (event.type === "warning") {
        erase();
        stream.write(`${paint("yellow", "⚠", color)} ${event.message}\n`);
        render();
        return;
      }
      if (event.type === "opinion") {
        voicesSeen++;
        if (tty) {
          voices.push(event.opinion);
          if (voices.length > VOICE_WINDOW) voices = voices.slice(-VOICE_WINDOW);
          render();
        } else if (voicesSeen <= 3 || voicesSeen % 5 === 0) {
          // Sampled voices keep CI logs alive without flooding them.
          const meta = clip(voiceMeta(event.opinion), 30);
          const text = clip(event.opinion.text, 96 - displayWidth(meta));
          stream.write(`  ${paint("dim", meta, color)}  ${text}\n`);
        }
        return;
      }
      if (event.type === "progress") {
        bar = { done: event.done, total: event.total };
        if (tty) {
          render();
        } else if (event.total > 1) {
          const pct = Math.floor((event.done / event.total) * 10) * 10;
          if (pct !== lastPct || event.done >= event.total) {
            lastPct = pct;
            stream.write(
              `  ${event.done}/${event.total} (${formatDuration(Date.now() - stageStart)})\n`,
            );
          }
        }
      }
    },
    finish() {
      finalizeStage();
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
    },
  };
}
