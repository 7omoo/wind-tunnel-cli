import { PassThrough } from "node:stream";
import { CuratedError, type ModelProvider } from "@wind-tunnel/core";
import { describe, expect, it, vi } from "vitest";
import { version } from "../package.json";
import { classifyError, renderError } from "../src/errors";

function connError(code: string): Error {
  const inner = new Error(`connect ${code} 127.0.0.1:11434`) as NodeJS.ErrnoException;
  inner.code = code;
  // Mirrors how undici/AI SDK surface it: a generic wrapper with a cause chain.
  return new Error("fetch failed", { cause: inner });
}

function timeoutError(): Error {
  const timeout = new Error("The operation was aborted due to timeout");
  timeout.name = "TimeoutError";
  return timeout;
}

function render(e: unknown, opts?: { resumeId?: string; providers?: ModelProvider[] }): string {
  const stream = new PassThrough();
  let out = "";
  stream.on("data", (chunk) => {
    out += String(chunk);
  });
  renderError(e, stream as unknown as NodeJS.WriteStream, opts);
  return out;
}

describe("classifyError", () => {
  it("recognizes a dead Ollama daemon through the cause chain", () => {
    const c = classifyError(
      new Error("all 8 persona reactions failed", { cause: connError("ECONNREFUSED") }),
    );
    expect(c.kind).toBe("ollama");
    expect(c.hints.join(" ")).toContain("restart");
  });

  it("recognizes timeouts from AbortSignal.timeout", () => {
    expect(classifyError(timeoutError()).kind).toBe("timeout");
  });

  // The remedy names the server the run actually uses.
  describe("timeout remedies follow the run's providers", () => {
    const text = (providers: ModelProvider[]) => {
      const c = classifyError(timeoutError(), { providers });
      return [c.headline, ...c.hints].join("\n");
    };

    it("points LM Studio runs at lms ps and an LM Studio restart", () => {
      const out = text(["lmstudio"]);
      expect(out).toContain("LM Studio");
      expect(out).toContain("lms ps");
      expect(out).not.toMatch(/ollama/i);
    });

    it("keeps the Ollama restart for Ollama runs", () => {
      const out = text(["ollama"]);
      expect(out).toContain("brew services restart ollama");
      expect(out).not.toContain("LM Studio");
    });

    it("covers both servers when a run mixes them", () => {
      const out = text(["ollama", "lmstudio"]);
      expect(out).toContain("brew services restart ollama");
      expect(out).toContain("lms ps");
    });

    it("blames no local server for a Gemini-only run", () => {
      const out = text(["gemini"]);
      expect(out).not.toMatch(/ollama|LM Studio/i);
    });
  });

  it("recognizes Hugging Face ingest failures before the generic connection class", () => {
    const c = classifyError(
      new Error(
        'IO Error: Connection error for HTTP GET error on "hf://datasets/nvidia/x.parquet"',
      ),
    );
    expect(c.kind).toBe("network");
  });

  it("recognizes disk and permission errors", () => {
    const enospc = new Error("write failed") as NodeJS.ErrnoException;
    enospc.code = "ENOSPC";
    expect(classifyError(enospc).kind).toBe("disk");
    const eacces = new Error("EACCES: permission denied, open '/x'");
    expect(classifyError(eacces).kind).toBe("permission");
  });

  it("passes curated errors (remedy in the message) through untouched", () => {
    const c = classifyError(
      new CuratedError("no persona pool installed — run: wt-cli personas pull usa"),
    );
    expect(c.kind).toBe("curated");
    expect(c.headline).toContain("wt-cli personas pull usa");
  });

  // Curated-ness is a type, not punctuation: a dependency's message that
  // happens to contain an em dash must still be classified normally.
  it("does not treat a foreign error as curated because of an em dash", () => {
    expect(classifyError(new Error("upstream said no — try later")).kind).toBe("unknown");
  });

  it("leaves unknown errors honest", () => {
    const c = classifyError(new Error("something odd happened"));
    expect(c.kind).toBe("unknown");
    expect(c.headline).toBe("something odd happened");
  });
});

describe("renderError", () => {
  it("adds the resume hint for classified failures but not for curated ones", () => {
    expect(render(connError("ECONNREFUSED"), { resumeId: "r1" })).toContain("wt-cli resume r1");
    expect(
      render(new CuratedError("country not in the pool — run: wt-cli personas pull jp"), {
        resumeId: "r1",
      }),
    ).not.toContain("resume r1");
  });

  it("passes the run's providers through to the classifier", () => {
    expect(render(timeoutError(), { providers: ["lmstudio"] })).toContain("lms ps");
  });

  it("points unknown errors at WT_DEBUG and the issue tracker, and only those", () => {
    expect(render(new Error("mystery"))).toContain("WT_DEBUG=1");
    expect(render(connError("ECONNREFUSED"))).not.toContain("WT_DEBUG=1");
  });

  it("reports the manifest's version in the WT_DEBUG line", () => {
    vi.stubEnv("WT_DEBUG", "1");
    try {
      expect(render(new Error("mystery"))).toContain(`[debug] wind-tunnel ${version} ·`);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
