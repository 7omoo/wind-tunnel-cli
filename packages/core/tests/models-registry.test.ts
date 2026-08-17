import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL_ROLES } from "../src/models/defaults";
import { parseModelSpec, resolveModel } from "../src/models/registry";
import { STAGE_NUM_CTX } from "../src/models/stages";

describe("parseModelSpec", () => {
  it("splits on the first colon only (Ollama names contain colons)", () => {
    expect(parseModelSpec("ollama:qwen3:8b")).toEqual({ provider: "ollama", name: "qwen3:8b" });
    expect(parseModelSpec("ollama:llama3.2")).toEqual({ provider: "ollama", name: "llama3.2" });
  });

  it("accepts gemini and its google alias", () => {
    expect(parseModelSpec("gemini:gemini-2.5-flash")).toEqual({
      provider: "gemini",
      name: "gemini-2.5-flash",
    });
    expect(parseModelSpec("google:gemini-2.5-flash").provider).toBe("gemini");
  });

  it("rejects specs without a provider or name", () => {
    expect(() => parseModelSpec("qwen3")).toThrow(/expected "provider:model"/);
    expect(() => parseModelSpec("ollama:")).toThrow(/expected "provider:model"/);
    expect(() => parseModelSpec("")).toThrow(/expected "provider:model"/);
  });

  it("rejects unknown providers loudly (no silent fallback)", () => {
    expect(() => parseModelSpec("openai:gpt-4o")).toThrow(/Unknown model provider/);
  });
});

describe("resolveModel", () => {
  it("constructs an Ollama model without network access", () => {
    const model = resolveModel("ollama:qwen3:0.6b", {}, { stage: "react" });
    expect(model).toBeTruthy();
  });

  it("requires an API key for gemini specs", () => {
    expect(() => resolveModel("gemini:gemini-2.5-flash")).toThrow(/Gemini API key/);
    expect(resolveModel("gemini:gemini-2.5-flash", { geminiApiKey: "test-key" })).toBeTruthy();
  });
});

describe("stage context budgets", () => {
  it("every stage has both a context budget and a call timeout", async () => {
    const { STAGE_TIMEOUT_MS } = await import("../src/models/stages");
    for (const stage of Object.keys(STAGE_NUM_CTX) as (keyof typeof STAGE_NUM_CTX)[]) {
      expect(STAGE_TIMEOUT_MS[stage]).toBeGreaterThanOrEqual(60_000);
    }
  });

  it("every stage has a positive budget and react stays small (parallelism)", () => {
    for (const ctx of Object.values(STAGE_NUM_CTX)) {
      expect(ctx).toBeGreaterThan(0);
    }
    expect(STAGE_NUM_CTX.react).toBeLessThanOrEqual(8192);
    // Whole-corpus stages need the large window.
    expect(STAGE_NUM_CTX.verdict).toBeGreaterThanOrEqual(32768);
    expect(STAGE_NUM_CTX.propositions).toBeGreaterThanOrEqual(32768);
  });

  it("default role specs parse", () => {
    for (const spec of Object.values(DEFAULT_MODEL_ROLES)) {
      expect(() => parseModelSpec(spec)).not.toThrow();
    }
  });
});
