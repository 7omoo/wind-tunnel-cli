// Mock LanguageModel helpers for pipeline unit tests. Built on the AI SDK's
// MockLanguageModelV4; generateText + Output.object parses the returned text,
// so JSON-producing stages are mocked by returning JSON strings.

import type { LanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";

type CallOptions = { prompt: unknown };

// Flatten a V4 prompt (message array with content parts) into plain text so
// dynamic mocks can parse ids/counts out of the actual prompt they received.
export function promptText(options: CallOptions): string {
  const parts: string[] = [];
  const prompt = options.prompt as { content?: unknown }[] | undefined;
  for (const message of prompt ?? []) {
    const content = message.content;
    if (typeof content === "string") {
      parts.push(content);
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (part && typeof part === "object" && "text" in part) {
          parts.push(String((part as { text: unknown }).text));
        }
      }
    }
  }
  return parts.join("\n");
}

// Derived from the mock's own signature so no extra provider dependency is
// needed just to name the result type.
type GenerateResult = Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>;

function generateResult(text: string): GenerateResult {
  return {
    content: [{ type: "text", text }],
    finishReason: { unified: "stop", raw: undefined },
    usage: {
      inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 1, text: 1, reasoning: undefined },
    },
    warnings: [],
  };
}

// Responds with the given texts in call order (last one repeats). Also usable
// with a function computing the response from the prompt.
export function textModel(
  responses: string[] | ((prompt: string, call: number) => string),
): LanguageModel & { calls: () => number } {
  let calls = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      const call = calls++;
      const text =
        typeof responses === "function"
          ? responses(promptText(options as CallOptions), call)
          : (responses[Math.min(call, responses.length - 1)] ?? "");
      return generateResult(text);
    },
  });
  return Object.assign(model, { calls: () => calls }) as LanguageModel & { calls: () => number };
}

export function failingModel(message = "mock model failure"): LanguageModel {
  return new MockLanguageModelV4({
    doGenerate: async () => {
      throw new Error(message);
    },
  }) as LanguageModel;
}

// Fails calls whose index (0-based) satisfies the predicate; succeeds otherwise.
export function flakyModel(failWhen: (call: number) => boolean, successText = "ok"): LanguageModel {
  let calls = 0;
  return new MockLanguageModelV4({
    doGenerate: async () => {
      const call = calls++;
      if (failWhen(call)) throw new Error(`mock failure on call ${call}`);
      return generateResult(successText);
    },
  }) as LanguageModel;
}
