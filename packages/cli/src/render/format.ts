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

// Single-value gauge: filled portion in the given style, remainder dim.
export function gauge(
  value: number,
  max: number,
  width: number,
  style: Parameters<typeof styleText>[0],
  enabled: boolean,
): string {
  const clamped = Math.min(Math.max(value, 0), max);
  const filled = Math.round((clamped / max) * width);
  return (
    paint(style, "█".repeat(filled), enabled) + paint("dim", "░".repeat(width - filled), enabled)
  );
}

export type BarSegment = { count: number; style: Parameters<typeof styleText>[0] };

// Proportional multi-segment bar (largest-remainder rounding so segments sum
// exactly to `width`; any non-zero segment keeps at least one visible cell).
export function segmentedBar(segments: BarSegment[], width: number, enabled: boolean): string {
  const total = segments.reduce((sum, s) => sum + s.count, 0);
  if (total <= 0) return paint("dim", "░".repeat(width), enabled);
  const exact = segments.map((s) => (s.count / total) * width);
  const cells = exact.map((e, i) => (segments[i]!.count > 0 ? Math.max(1, Math.floor(e)) : 0));
  let used = cells.reduce((a, b) => a + b, 0);
  // Distribute (or reclaim) the rounding difference by largest remainder.
  const order = exact
    .map((e, i) => ({ i, remainder: e - Math.floor(e) }))
    .sort((a, b) => b.remainder - a.remainder);
  let k = 0;
  while (used < width && order.length > 0) {
    const slot = order[k % order.length]!.i;
    if (segments[slot]!.count > 0) {
      cells[slot]!++;
      used++;
    }
    k++;
  }
  k = 0;
  while (used > width && order.length > 0) {
    const slot = order[order.length - 1 - (k % order.length)]!.i;
    if ((cells[slot] ?? 0) > 1) {
      cells[slot]!--;
      used--;
    }
    k++;
  }
  return segments
    .map((s, i) => ((cells[i] ?? 0) > 0 ? paint(s.style, "█".repeat(cells[i]!), enabled) : ""))
    .join("");
}

// Display width of one code point: CJK/fullwidth = 2 columns, else 1.
// Covers the ranges that matter for this tool's output (kana, han, hangul,
// fullwidth forms, CJK punctuation); zero-width joiners etc. are not handled.
function charWidth(codePoint: number): number {
  return (codePoint >= 0x1100 && codePoint <= 0x115f) || // hangul jamo
    (codePoint >= 0x2e80 && codePoint <= 0x303e) || // CJK radicals, punctuation
    (codePoint >= 0x3041 && codePoint <= 0x33ff) || // kana, CJK symbols
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) || // CJK ext A
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) || // CJK unified
    (codePoint >= 0xa000 && codePoint <= 0xa4cf) || // yi
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) || // hangul syllables
    (codePoint >= 0xf900 && codePoint <= 0xfaff) || // CJK compat
    (codePoint >= 0xfe30 && codePoint <= 0xfe4f) || // CJK compat forms
    (codePoint >= 0xff00 && codePoint <= 0xff60) || // fullwidth forms
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) || // fullwidth signs
    (codePoint >= 0x20000 && codePoint <= 0x3fffd) // CJK ext B+
    ? 2
    : 1;
}

// Terminal display width of a string (CJK-aware). Used instead of .length for
// every layout decision — Japanese output would otherwise render at twice the
// budgeted width and wrap mid-line on 80-column terminals.
export function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text) width += charWidth(ch.codePointAt(0) ?? 0);
  return width;
}

// Clip to a display width (not a character count), appending an ellipsis.
export function clip(text: string, maxWidth: number): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (displayWidth(oneLine) <= maxWidth) return oneLine;
  let out = "";
  let width = 0;
  for (const ch of oneLine) {
    const w = charWidth(ch.codePointAt(0) ?? 0);
    if (width + w > maxWidth - 1) break; // reserve one column for the ellipsis
    out += ch;
    width += w;
  }
  return `${out}…`;
}

// Wrap to a display width with a hanging indent for continuation lines.
// Prefers breaking at spaces so Latin words stay whole — but only when the
// kept part fills at least 60% of the line; otherwise it breaks at the width
// limit instead (mixed lines like "1. <long CJK prose>" would otherwise leave
// a nearly empty "1." line, since CJK has no other spaces to break at).
// Characters that must not start a line (Japanese line-breaking rules,
// 行頭禁則). When a wrap would land one of these at a line start, it hangs at
// the end of the previous line instead (at most a couple of columns over).
const KINSOKU_NO_START = new Set([..."。、．，）」』】〉》！？：；…ー・)],.!?"]);

// wrap() clamped to a maximum number of lines; the last kept line gets an
// ellipsis. Used where a long voice must stay a card-sized excerpt.
export function wrapLines(
  text: string,
  maxWidth: number,
  indent: string,
  maxLines: number,
): string[] {
  const lines = wrap(text, maxWidth, indent);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  const last = kept[maxLines - 1] ?? "";
  kept[maxLines - 1] = clip(`${last}…`, maxWidth);
  return kept;
}

export function wrap(text: string, maxWidth: number, indent = ""): string[] {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (!oneLine) return [];
  const lines: string[] = [];
  let line = "";
  let width = 0;
  let lastSpace = -1; // index in `line` of the last breakable space
  const contBudget = maxWidth - displayWidth(indent);
  for (const ch of oneLine) {
    const w = charWidth(ch.codePointAt(0) ?? 0);
    const budget = lines.length === 0 ? maxWidth : contBudget;
    if (width + w > budget && !KINSOKU_NO_START.has(ch)) {
      if (ch === " ") {
        // Break exactly here; the space dies at the line end.
        lines.push(line);
        line = "";
        width = 0;
        lastSpace = -1;
        continue;
      }
      const keptWidth = lastSpace > 0 ? displayWidth(line.slice(0, lastSpace)) : 0;
      if (lastSpace > 0 && keptWidth >= budget * 0.6) {
        lines.push(line.slice(0, lastSpace));
        line = line.slice(lastSpace + 1);
        width = displayWidth(line);
        lastSpace = -1;
      } else {
        lines.push(line);
        line = "";
        width = 0;
        lastSpace = -1;
      }
    }
    if (ch === " ") lastSpace = line.length;
    line += ch;
    width += w;
  }
  if (line) lines.push(line);
  return lines.map((l, i) => (i === 0 ? l : indent + l));
}
