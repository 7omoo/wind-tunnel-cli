import { DEFAULT_MODEL_ROLES, DEFAULT_OLLAMA_URL } from "@wind-tunnel/core";
import { describe, expect, it } from "vitest";
import { doctorTarget } from "../src/commands/doctor";
import { resolveConfig } from "../src/config";

// doctor must check the environment `run` will actually use, so it reads the
// same resolved config instead of re-deriving host and models on its own.
describe("doctorTarget", () => {
  it("falls back to the default host and default role models", () => {
    expect(doctorTarget(resolveConfig({}))).toEqual({
      baseUrl: DEFAULT_OLLAMA_URL,
      roles: DEFAULT_MODEL_ROLES,
    });
  });

  it("uses the host and models pinned in config.toml", () => {
    const cfg = resolveConfig({
      fileText: '[ollama]\nhost = "10.0.0.9:11434"\n\n[model]\nbulk = "llama3.1:8b"\n',
    });
    const target = doctorTarget(cfg);
    expect(target.baseUrl).toBe("http://10.0.0.9:11434");
    expect(target.roles.bulk).toBe("llama3.1:8b");
  });

  it("honors WT_OLLAMA_HOST and the hybrid profile", () => {
    const cfg = resolveConfig({ env: { WT_OLLAMA_HOST: "gpu-box:11434", WT_PROFILE: "hybrid" } });
    const target = doctorTarget(cfg);
    expect(target.baseUrl).toBe("http://gpu-box:11434");
    expect(target.roles.analysis).toMatch(/^gemini:/);
  });

  it("normalizes a scheme-less --host the same way run does", () => {
    const cfg = resolveConfig({ flags: { host: "10.0.0.9:11434" } });
    expect(doctorTarget(cfg).baseUrl).toBe("http://10.0.0.9:11434");
  });
});
