// HTTP probes against Ollama and LM Studio (doctor + run preflight), checked
// against a local server that returns well-formed, partial, and broken bodies.
// The probes parse defensively because fields differ across server versions.

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getLmStudioLoadedContext, listLmStudioModels } from "../src/lmstudio/client";
import { diagnoseLmStudio, needsLargerContext } from "../src/lmstudio/doctor";
import {
  getModelCapabilities,
  getOllamaVersion,
  isModelInstalled,
  listInstalledModels,
  listRunningModels,
} from "../src/ollama/client";
import { diagnoseOllama } from "../src/ollama/doctor";

// Nothing listens on port 9 (discard) — a reliable "unreachable" target.
const UNREACHABLE = "http://127.0.0.1:9";

type Route = { status?: number; body: unknown };
let routes: Record<string, Route> = {};
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const route = routes[`${req.method} ${req.url}`];
    res.writeHead(route?.status ?? (route ? 200 : 404), { "Content-Type": "application/json" });
    res.end(JSON.stringify(route?.body ?? { error: "not found" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  routes = {};
});

describe("Ollama probes", () => {
  it("reads the version, and reports null when down or erroring", async () => {
    routes["GET /api/version"] = { body: { version: "0.12.3" } };
    expect(await getOllamaVersion(baseUrl)).toBe("0.12.3");
    routes["GET /api/version"] = { status: 500, body: {} };
    expect(await getOllamaVersion(baseUrl)).toBeNull();
    expect(await getOllamaVersion(UNREACHABLE)).toBeNull();
  });

  it("lists installed models, skipping nameless entries and defaulting missing sizes", async () => {
    routes["GET /api/tags"] = {
      body: {
        models: [
          {
            name: "qwen3:8b",
            size: 5e9,
            details: { parameter_size: "8.2B", quantization_level: "Q4_K_M" },
          },
          { name: "tiny" },
          { size: 1 },
        ],
      },
    };
    expect(await listInstalledModels(baseUrl)).toEqual([
      { name: "qwen3:8b", sizeBytes: 5e9, parameterSize: "8.2B", quantization: "Q4_K_M" },
      { name: "tiny", sizeBytes: 0, parameterSize: undefined, quantization: undefined },
    ]);
  });

  it("throws when the model list itself fails", async () => {
    routes["GET /api/tags"] = { status: 503, body: {} };
    await expect(listInstalledModels(baseUrl)).rejects.toThrow("503");
  });

  it("lists running models with optional fields only when well-typed", async () => {
    routes["GET /api/ps"] = {
      body: { models: [{ name: "qwen3:8b", size_vram: 6e9, context_length: "8192" }] },
    };
    expect(await listRunningModels(baseUrl)).toEqual([
      { name: "qwen3:8b", sizeVramBytes: 6e9, contextLength: undefined, expiresAt: undefined },
    ]);
  });

  it("matches a bare name against Ollama's implicit :latest tag", () => {
    const installed = [{ name: "qwen3:latest", sizeBytes: 0 }];
    expect(isModelInstalled(installed, "qwen3")).toBe(true);
    expect(isModelInstalled(installed, "qwen3:8b")).toBe(false);
  });

  it("reads capabilities, keeping only strings, and null otherwise", async () => {
    routes["POST /api/show"] = { body: { capabilities: ["completion", 7, "thinking"] } };
    expect(await getModelCapabilities("m", baseUrl)).toEqual(["completion", "thinking"]);
    routes["POST /api/show"] = { body: { capabilities: "thinking" } };
    expect(await getModelCapabilities("m", baseUrl)).toBeNull();
    routes["POST /api/show"] = { status: 404, body: {} };
    expect(await getModelCapabilities("m", baseUrl)).toBeNull();
  });

  it("diagnoses role models against what is installed", async () => {
    routes["GET /api/version"] = { body: { version: "0.12.3" } };
    routes["GET /api/tags"] = { body: { models: [{ name: "qwen3:8b", size: 1 }] } };
    routes["GET /api/ps"] = { body: { models: [] } };
    const report = await diagnoseOllama({
      baseUrl,
      roles: { bulk: "ollama:qwen3:8b", analysis: "ollama:qwen3:14b", premium: "gemini:x" },
    });
    expect(report.reachable).toBe(true);
    expect(report.roleChecks.map((c) => [c.role, c.installed])).toEqual([
      ["bulk", true],
      ["analysis", false],
      ["premium", null], // not an Ollama model: not checked here
    ]);
    expect(report.roleChecks[1]?.pullName).toBe("qwen3:14b");
  });

  it("reports an unreachable daemon without failing", async () => {
    const report = await diagnoseOllama({
      baseUrl: UNREACHABLE,
      roles: { bulk: "ollama:a", analysis: "ollama:a", premium: "ollama:a" },
    });
    expect(report.reachable).toBe(false);
    expect(report.roleChecks.every((c) => c.installed === false)).toBe(true);
  });
});

describe("LM Studio probes", () => {
  it("lists model ids, or null when the server is down", async () => {
    routes["GET /v1/models"] = { body: { data: [{ id: "qwen/qwen3-4b-2507" }, { id: 3 }, {}] } };
    expect(await listLmStudioModels(baseUrl)).toEqual(["qwen/qwen3-4b-2507"]);
    expect(await listLmStudioModels(UNREACHABLE)).toBeNull();
  });

  it("reads the loaded context only for a loaded model", async () => {
    const path = `GET /api/v0/models/${encodeURIComponent("qwen/qwen3-4b-2507")}`;
    routes[path] = { body: { state: "loaded", loaded_context_length: 32768 } };
    expect(await getLmStudioLoadedContext("qwen/qwen3-4b-2507", baseUrl)).toBe(32768);
    routes[path] = { body: { state: "not-loaded", max_context_length: 262144 } };
    expect(await getLmStudioLoadedContext("qwen/qwen3-4b-2507", baseUrl)).toBeNull();
    routes[path] = { status: 404, body: {} };
    expect(await getLmStudioLoadedContext("qwen/qwen3-4b-2507", baseUrl)).toBeNull();
  });

  it("diagnoses each lmstudio role: available, and loaded with enough context", async () => {
    routes["GET /v1/models"] = { body: { data: [{ id: "a" }, { id: "b" }] } };
    routes["GET /api/v0/models/a"] = { body: { state: "loaded", loaded_context_length: 32768 } };
    routes["GET /api/v0/models/b"] = { body: { state: "loaded", loaded_context_length: 4096 } };
    const report = await diagnoseLmStudio({
      baseUrl,
      roles: { bulk: "lmstudio:a", analysis: "lmstudio:b", premium: "lmstudio:c" },
    });
    expect(report.reachable).toBe(true);
    expect(
      report.roleChecks.map((c) => [c.role, c.available, c.loadedContext, needsLargerContext(c)]),
    ).toEqual([
      ["bulk", true, 32768, false],
      ["analysis", true, 4096, true],
      ["premium", false, null, true],
    ]);
  });

  it("skips non-lmstudio roles and reports an unreachable server", async () => {
    const report = await diagnoseLmStudio({
      baseUrl: UNREACHABLE,
      roles: { bulk: "lmstudio:a", analysis: "ollama:x", premium: "gemini:y" },
    });
    expect(report.reachable).toBe(false);
    expect(report.roleChecks.map((c) => c.role)).toEqual(["bulk"]);
  });
});
