// Filesystem locations. XDG base dirs on every platform (macOS included) —
// predictable, greppable, documented in docs/DESIGN.md §8.

import { randomInt } from "node:crypto";
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
  // Uniform over [a-z0-9]^4. (Math.random().toString(36) can come back short
  // and was zero-padded, shrinking the space.) RunStore.create still refuses
  // an existing directory, so a same-second collision cannot clobber a run.
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const rand = Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join("");
  return `${stamp}-${rand}`;
}
