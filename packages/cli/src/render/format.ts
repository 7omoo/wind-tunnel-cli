// Small terminal formatting helpers. Color respects NO_COLOR and non-TTY
// output; everything else is plain string math so it stays testable.

import { styleText } from "node:util";

type Style = Parameters<typeof styleText>[0];

export function useColor(stream: NodeJS.WriteStream = process.stdout): boolean {
  if (process.env.NO_COLOR) return false;
  return Boolean(stream.isTTY);
}

export function paint(style: Style, text: string, enabled: boolean): string {
  return enabled ? styleText(style, text) : text;
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

export function progressBar(done: number, total: number, width = 20): string {
  if (total <= 0) return " ".repeat(width);
  const filled = Math.round((Math.min(done, total) / total) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

export function clip(text: string, limit: number): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > limit ? `${oneLine.slice(0, limit)}…` : oneLine;
}
