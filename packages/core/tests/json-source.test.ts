// loadJsonPersonaSource is the input surface for custom pools (--personas-file),
// so its format tolerance and its refusals are user-facing behavior.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadJsonPersonaSource } from "../src/personas/json-source";
import { FIXTURE_PERSONAS_JP } from "./fixtures/personas-jp";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "wt-json-src-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function write(name: string, body: unknown): Promise<string> {
  const p = join(dir, name);
  await writeFile(p, JSON.stringify(body));
  return p;
}

describe("loadJsonPersonaSource", () => {
  it("accepts both a bare array and a { personas, version } wrapper", async () => {
    const bare = await loadJsonPersonaSource(await write("bare.json", FIXTURE_PERSONAS_JP));
    expect(await bare.sample({ country: "jp", count: 3 })).toHaveLength(3);
    expect(await bare.poolVersion("jp")).toBe(`json-${FIXTURE_PERSONAS_JP.length}`);

    const wrapped = await loadJsonPersonaSource(
      await write("wrapped.json", { personas: FIXTURE_PERSONAS_JP, version: "v7" }),
    );
    expect(await wrapped.poolVersion("jp")).toBe("v7");
  });

  it("refuses an empty pool with the file path in the message", async () => {
    const p = await write("empty.json", { personas: [] });
    await expect(loadJsonPersonaSource(p)).rejects.toThrow(p);
  });
});
