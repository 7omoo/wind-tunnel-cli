import { CuratedError } from "@wind-tunnel/core";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "../src/config";

// Captures the error a call throws, so its class and message can both be checked.
function failure(fn: () => unknown): Error {
  try {
    fn();
  } catch (e) {
    return e as Error;
  }
  throw new Error("expected the call to throw");
}

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

  // Every rejection is a CuratedError: the CLI prints it as written, with the
  // valid options, instead of zod's issue list plus a "report an issue" hint.
  describe("invalid values", () => {
    it.each([
      [{ country: "zz" }, 'unknown country "zz" — one of: jp, usa, in, br, fr, kr, vn, be'],
      [
        { situation: "twitter" },
        'unknown situation "twitter" — one of: anon_board, sns_viral, news_comment, public_comment, real_sns, consumer_survey',
      ],
      [{ outputLang: "de" }, 'unknown output language "de" — one of: ja, en'],
      [{ profile: "cloud" }, 'unknown profile "cloud" — one of: local, hybrid'],
    ])("names the setting, the value and the valid options for %j", (flags, message) => {
      const e = failure(() => resolveConfig({ flags }));
      expect(e).toBeInstanceOf(CuratedError);
      expect(e.message).toBe(message);
    });

    it("curates the numeric limits and non-integers", () => {
      const tooMany = failure(() => resolveConfig({ flags: { personas: 5000 } }));
      expect(tooMany).toBeInstanceOf(CuratedError);
      expect(tooMany.message).toMatch(/1000 or fewer/);
      const notANumber = failure(() => resolveConfig({ env: { WT_BATCH: "abc" } }));
      expect(notANumber).toBeInstanceOf(CuratedError);
      expect(notANumber.message).toMatch(/WT_BATCH must be a positive integer/);
    });

    it("names the config file and the offending key for a bad config.toml", () => {
      const e = failure(() =>
        resolveConfig({ fileText: `run = "oops"`, configPath: "/home/me/.config/wt/config.toml" }),
      );
      expect(e).toBeInstanceOf(CuratedError);
      expect(e.message).toMatch(/^invalid \/home\/me\/\.config\/wt\/config\.toml: run: /);
      // Without a path the file is still named.
      expect(failure(() => resolveConfig({ fileText: `run = "oops"` })).message).toMatch(
        /^invalid config\.toml: run: /,
      );
    });
  });
});
