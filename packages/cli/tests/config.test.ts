import { describe, expect, it } from "vitest";
import { resolveConfig } from "../src/config";

const TOML = `
profile = "local"

[model]
bulk = "ollama:qwen3:8b"
analysis = "ollama:qwen3:14b"

[run]
country = "fr"
personas = 200
batch = 8
output_lang = "en"

[ollama]
host = "http://10.0.0.2:11434"
`;

describe("resolveConfig", () => {
  it("uses built-in defaults when nothing is provided", () => {
    const cfg = resolveConfig({});
    expect(cfg.profile).toBe("local");
    expect(cfg.run).toEqual({
      country: "usa",
      personas: 100,
      batch: 5,
      outputLang: "en",
      situation: "sns_viral",
    });
    expect(cfg.models.bulk).toMatch(/^ollama:/);
    expect(cfg.ollamaHost).toBeUndefined();
  });

  it("derives the analysis language from the country unless set explicitly", () => {
    expect(resolveConfig({ flags: { country: "jp" } }).run.outputLang).toBe("ja");
    expect(resolveConfig({ flags: { country: "fr" } }).run.outputLang).toBe("en");
    expect(resolveConfig({ flags: { country: "jp", outputLang: "en" } }).run.outputLang).toBe("en");
  });

  it("reads values from config.toml", () => {
    const cfg = resolveConfig({ fileText: TOML });
    expect(cfg.run.country).toBe("fr");
    expect(cfg.run.personas).toBe(200);
    expect(cfg.run.batch).toBe(8);
    expect(cfg.run.outputLang).toBe("en");
    expect(cfg.models.analysis).toBe("ollama:qwen3:14b");
    expect(cfg.ollamaHost).toBe("http://10.0.0.2:11434");
  });

  it("environment overrides the file, flags override the environment", () => {
    const cfg = resolveConfig({
      fileText: TOML,
      env: { WT_COUNTRY: "kr", WT_PERSONAS: "50" },
      flags: { country: "br" },
    });
    expect(cfg.run.country).toBe("br"); // flag wins
    expect(cfg.run.personas).toBe(50); // env beats file
    expect(cfg.run.batch).toBe(8); // file survives where nothing overrides
  });

  it("hybrid profile swaps analysis/premium to gemini, bulk stays local", () => {
    const cfg = resolveConfig({ flags: { profile: "hybrid" } });
    expect(cfg.models.bulk).toMatch(/^ollama:/);
    expect(cfg.models.analysis).toMatch(/^gemini:/);
    expect(cfg.models.premium).toMatch(/^gemini:/);
  });

  it("explicit model settings beat the profile defaults", () => {
    const cfg = resolveConfig({
      flags: { profile: "hybrid", modelAnalysis: "ollama:qwen3:14b" },
    });
    expect(cfg.models.analysis).toBe("ollama:qwen3:14b");
    expect(cfg.models.premium).toMatch(/^gemini:/);
  });

  it("normalizes a bare host to a URL and picks up OLLAMA_HOST", () => {
    expect(resolveConfig({ env: { OLLAMA_HOST: "10.0.0.9:11434" } }).ollamaHost).toBe(
      "http://10.0.0.9:11434",
    );
    expect(
      resolveConfig({ env: { OLLAMA_HOST: "http://a", WT_OLLAMA_HOST: "http://b" } }).ollamaHost,
    ).toBe("http://b");
  });

  it("reads the gemini key from env or file", () => {
    expect(resolveConfig({ env: { GEMINI_API_KEY: "k1" } }).geminiApiKey).toBe("k1");
    expect(resolveConfig({ fileText: `[model]\ngemini_api_key = "k2"\n` }).geminiApiKey).toBe("k2");
  });

  it("rejects invalid values loudly", () => {
    expect(() => resolveConfig({ flags: { country: "xx" } })).toThrow();
    expect(() => resolveConfig({ flags: { personas: 5000 } })).toThrow(/1000 or fewer/);
    expect(() => resolveConfig({ env: { WT_BATCH: "abc" } })).toThrow(/positive integer/);
    expect(() => resolveConfig({ fileText: `run = "oops"` })).toThrow(/invalid config.toml/);
  });
});
