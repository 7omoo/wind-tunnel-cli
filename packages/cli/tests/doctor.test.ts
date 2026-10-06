import {
  DEFAULT_LMSTUDIO_URL,
  DEFAULT_MODEL_ROLES,
  DEFAULT_OLLAMA_URL,
  LMSTUDIO_MIN_CONTEXT,
  type LmStudioDoctorReport,
  type LmStudioRoleCheck,
} from "@wind-tunnel/core";
import { describe, expect, it } from "vitest";
import { doctorTarget, renderLmStudioReport } from "../src/commands/doctor";
import { resolveConfig } from "../src/config";

// doctor must check the environment `run` will actually use, so it reads the
// same resolved config instead of re-deriving hosts and models on its own.
describe("doctorTarget", () => {
  it("falls back to the default hosts and default role models", () => {
    expect(doctorTarget(resolveConfig({}))).toEqual({
      roles: DEFAULT_MODEL_ROLES,
      ollamaBaseUrl: DEFAULT_OLLAMA_URL,
      lmstudioBaseUrl: DEFAULT_LMSTUDIO_URL,
    });
  });

  it("uses the hosts and models pinned in config.toml", () => {
    const cfg = resolveConfig({
      fileText: [
        "[ollama]",
        'host = "10.0.0.9:11434"',
        "[lmstudio]",
        'host = "10.0.0.9:1234"',
        "[model]",
        'bulk = "lmstudio:qwen/qwen3-4b-2507"',
      ].join("\n"),
    });
    const target = doctorTarget(cfg);
    expect(target.ollamaBaseUrl).toBe("http://10.0.0.9:11434");
    expect(target.lmstudioBaseUrl).toBe("http://10.0.0.9:1234");
    expect(target.roles.bulk).toBe("lmstudio:qwen/qwen3-4b-2507");
  });

  it("honors WT_OLLAMA_HOST, WT_LMSTUDIO_HOST and the hybrid profile", () => {
    const cfg = resolveConfig({
      env: { WT_OLLAMA_HOST: "gpu-box:11434", WT_LMSTUDIO_HOST: "mac:1234", WT_PROFILE: "hybrid" },
    });
    const target = doctorTarget(cfg);
    expect(target.ollamaBaseUrl).toBe("http://gpu-box:11434");
    expect(target.lmstudioBaseUrl).toBe("http://mac:1234");
    expect(target.roles.analysis).toMatch(/^gemini:/);
  });

  it("normalizes a scheme-less --host the same way run does", () => {
    const cfg = resolveConfig({ flags: { host: "10.0.0.9:11434" } });
    expect(doctorTarget(cfg).ollamaBaseUrl).toBe("http://10.0.0.9:11434");
  });
});

describe("renderLmStudioReport", () => {
  const report = (overrides: Partial<LmStudioDoctorReport>): LmStudioDoctorReport => ({
    baseUrl: DEFAULT_LMSTUDIO_URL,
    reachable: true,
    models: [],
    roleChecks: [],
    ...overrides,
  });
  const check = (overrides: Partial<LmStudioRoleCheck>): LmStudioRoleCheck => ({
    role: "bulk",
    spec: "lmstudio:a",
    model: "a",
    available: true,
    loadedContext: LMSTUDIO_MIN_CONTEXT,
    ...overrides,
  });

  it("fails with start instructions when the server is down", () => {
    const { text, ok } = renderLmStudioReport(report({ reachable: false }));
    expect(ok).toBe(false);
    expect(text).toContain("lms server start");
  });

  it("names the `lms get` command for a missing role model", () => {
    const { text, ok } = renderLmStudioReport(
      report({
        roleChecks: [check({}), check({ role: "analysis", model: "b", available: false })],
      }),
    );
    expect(ok).toBe(false);
    expect(text).toContain("lms get b");
  });

  // LM Studio fixes context at load time; its default (4096) is too small for
  // the analysis prompts, and an unloaded model would be loaded with it.
  it.each([4096, null])("asks to reload with enough context when loaded with %s", (ctx) => {
    const { text, ok } = renderLmStudioReport(
      report({ roleChecks: [check({ loadedContext: ctx })] }),
    );
    expect(ok).toBe(false);
    expect(text).toContain(`lms load a -c ${LMSTUDIO_MIN_CONTEXT}`);
  });

  it("passes when every role model is available with enough context", () => {
    const { ok } = renderLmStudioReport(report({ roleChecks: [check({})] }));
    expect(ok).toBe(true);
  });
});
