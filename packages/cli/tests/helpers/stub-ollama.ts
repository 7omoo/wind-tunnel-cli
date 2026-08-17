// In-process stub of the Ollama HTTP API, just enough surface for the CLI to
// complete a full run: /api/version and /api/tags (preflight), /api/show
// (capability probe), /api/chat (generation, streaming and non-streaming).
//
// The routing brain mirrors packages/core/tests/run-execute.test.ts: one model
// answers every stage by recognizing the prompt's shape. Duplicated on purpose —
// the black-box E2E must not import project code, only speak HTTP and argv.

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export type ChatRequest = {
  model: string;
  messages: { role: string; content: string }[];
  stream?: boolean;
  format?: unknown;
  options?: { num_ctx?: number } & Record<string, unknown>;
};

export type StubOllama = {
  url: string;
  /** Every /api/chat body, in arrival order. */
  chatRequests: ChatRequest[];
  close(): Promise<void>;
};

// English-output routing (outputLang "en"): markers come from the real prompts.
function respond(prompt: string, call: number): string {
  if (prompt.includes("Score every reaction")) {
    const ids = [...prompt.matchAll(/^\[([^\]]+)\]/gm)].map((m) => m[1] as string);
    return JSON.stringify({
      scores: ids.map((personaId, i) => ({
        personaId,
        stance: i % 2 === 0 ? "critical" : "favorable",
        intensity: i % 2 === 0 ? 60 : 55,
        reason: "stub reason",
      })),
    });
  }
  if (prompt.includes("Extract 10-15 specific propositions")) {
    return JSON.stringify({
      propositions: [
        { text: "The offer feels manipulative" },
        { text: "The pricing is fair" },
        { text: "The tone fits the audience" },
      ],
    });
  }
  if (prompt.includes("Return votes as one row per opinion")) {
    const rows = [...prompt.matchAll(/^Opinion \d+: "(.+)"$/gm)].map((_, i) =>
      i % 2 === 0 ? [1, -1, 1] : [-1, 1, -1],
    );
    return JSON.stringify({ votes: rows });
  }
  if (prompt.includes("principal component axes")) {
    const k = Number(prompt.match(/Return exactly (\d+) labels/)?.[1] ?? 2);
    return JSON.stringify({
      labels: Array.from({ length: k }, (_, i) => `axis ${i + 1} low <-> high`),
    });
  }
  if (prompt.includes("group profiles")) {
    const count = Number(prompt.match(/Return exactly (\d+) group profiles/)?.[1] ?? 2);
    return JSON.stringify({
      groups: Array.from({ length: count }, (_, i) => ({
        name: i === 0 ? "Value Seekers" : `Skeptics ${i + 1}`,
        coreBelief: "a good deal should not need pressure",
        keyValues: ["fairness"],
        representativeQuote: "Just show me the price.",
      })),
      minority: { narrative: "A small camp reads the urgency as honest.", blindSpots: ["tone"] },
    });
  }
  if (prompt.includes("alternatives")) {
    return JSON.stringify({
      alternatives: [
        {
          text: "Rewrite A",
          strategy: "soften",
          targetTriggers: [0],
          estimatedRiskReduction: "High",
          reasoning: "stub",
        },
      ],
      commonGround: "Everyone wants the terms upfront.",
    });
  }
  if (prompt.includes("Post content") && prompt.includes("Aggregate")) {
    return JSON.stringify({
      inflammationIndex: 62,
      riskLevel: "High",
      summary: "Pushback is likely.",
      triggers: [
        {
          expression: "act now",
          offendedSegment: "deal-wary shoppers",
          severity: "High",
          count: 4,
          sampleOpinionIds: ["usa-001"],
        },
      ],
      safeVersion: "A calmer version of the post.",
    });
  }
  return `Reaction ${call}: this offer worries me a little.`;
}

function chatChunk(model: string, fields: Record<string, unknown>): string {
  return `${JSON.stringify({ model, created_at: "2026-08-17T00:00:00Z", ...fields })}\n`;
}

const DONE_FIELDS = {
  done: true,
  done_reason: "stop",
  total_duration: 1_000_000,
  load_duration: 1_000_000,
  prompt_eval_count: 10,
  prompt_eval_duration: 1_000_000,
  eval_count: 10,
  eval_duration: 1_000_000,
};

export async function startStubOllama(): Promise<StubOllama> {
  const chatRequests: ChatRequest[] = [];
  let calls = 0;

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const path = (req.url ?? "").split("?")[0];
      const json = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };

      if (path === "/api/version") return json(200, { version: "0.0.0-stub" });
      if (path === "/api/tags") {
        return json(200, {
          models: [{ name: "stub:8b", model: "stub:8b", modified_at: "", size: 1, digest: "d" }],
        });
      }
      if (path === "/api/ps") return json(200, { models: [] });
      if (path === "/api/show") return json(200, { capabilities: ["completion"] });

      if (path === "/api/chat") {
        const body = JSON.parse(Buffer.concat(chunks).toString()) as ChatRequest;
        chatRequests.push(body);
        const prompt = body.messages.map((m) => m.content).join("\n");
        const text = respond(prompt, calls++);
        // The daemon streams NDJSON unless the client asks stream:false.
        if (body.stream === false) {
          return json(200, {
            model: body.model,
            created_at: "2026-08-17T00:00:00Z",
            message: { role: "assistant", content: text },
            ...DONE_FIELDS,
          });
        }
        res.writeHead(200, { "content-type": "application/x-ndjson" });
        res.write(
          chatChunk(body.model, { message: { role: "assistant", content: text }, done: false }),
        );
        res.end(
          chatChunk(body.model, { message: { role: "assistant", content: "" }, ...DONE_FIELDS }),
        );
        return;
      }

      json(404, { error: `stub: no route for ${req.method} ${path}` });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    chatRequests,
    close: () => new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}
