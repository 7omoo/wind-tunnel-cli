// Filesystem locations. XDG base dirs on every platform (macOS included) —
// predictable, greppable, documented in docs/DESIGN.md §8.

import { homedir } from "node:os";
import { join } from "node:path";

export function dataRoot(): string {
  const xdg = process.env.XDG_DATA_HOME;
  const base = xdg && xdg.trim() !== "" ? xdg : join(homedir(), ".local", "share");
  return join(base, "wind-tunnel");
}

export function runsRoot(): string {
  return join(dataRoot(), "runs");
}

export function configRoot(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.trim() !== "" ? xdg : join(homedir(), ".config");
  return join(base, "wind-tunnel");
}

// Sortable, human-readable run id: "20260817-143512-x4k9".
export function newRunId(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const rand = Math.random().toString(36).slice(2, 6).padEnd(4, "0");
  return `${stamp}-${rand}`;
}
