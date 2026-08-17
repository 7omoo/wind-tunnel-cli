import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { classifyError, renderError } from "../src/errors";

function connError(code: string): Error {
  const inner = new Error(`connect ${code} 127.0.0.1:11434`) as NodeJS.ErrnoException;
  inner.code = code;
  // Mirrors how undici/AI SDK surface it: a generic wrapper with a cause chain.
  return new Error("fetch failed", { cause: inner });
}

function render(e: unknown, opts?: { resumeId?: string }): string {
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
    const timeout = new Error("The operation was aborted due to timeout");
    timeout.name = "TimeoutError";
    expect(classifyError(timeout).kind).toBe("timeout");
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

  it("passes curated errors (em-dash remedies) through untouched", () => {
    const c = classifyError(new Error("no persona pool installed — run: wt-cli personas pull usa"));
    expect(c.kind).toBe("curated");
    expect(c.headline).toContain("wt-cli personas pull usa");
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
      render(new Error("country not in the pool — run: wt-cli personas pull jp"), {
        resumeId: "r1",
      }),
    ).not.toContain("resume r1");
  });

  it("points unknown errors at WT_DEBUG and the issue tracker, and only those", () => {
    expect(render(new Error("mystery"))).toContain("WT_DEBUG=1");
    expect(render(connError("ECONNREFUSED"))).not.toContain("WT_DEBUG=1");
  });
});
