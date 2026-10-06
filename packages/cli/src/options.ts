// Commander option parsers shared by every command.

import { InvalidArgumentError } from "commander";

// Strict non-negative integer. Number.parseInt would accept "12abc" as 12 and
// turn "abc" into NaN, which then flowed on unchecked (into the age filter, or
// `detail --group`, where NaN matched no check and showed every voice).
// Throwing InvalidArgumentError lets commander report the bad flag and exit 1.
export function integerOption(value: string): number {
  if (!/^\d+$/.test(value)) throw new InvalidArgumentError("Not a non-negative integer.");
  return Number(value);
}
