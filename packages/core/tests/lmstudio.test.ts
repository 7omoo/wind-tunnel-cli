import { generateText, Output, wrapLanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { reasoningAsJsonTextMiddleware } from "../src/lmstudio/reasoning-workaround";
import { retryUnenforcedJsonMiddleware } from "../src/lmstudio/structured-output-retry";

type GenerateResult = Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>;
type Content = GenerateResult["content"];

// A model returning fixed content parts, wrapped like registry.ts wraps LM Studio.
function lmstudioLike(content: Content) {
  return wrapLanguageModel({
    model: new MockLanguageModelV4({
      doGenerate: async () => ({
        content,
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 1, text: 1, reasoning: undefined },
        },
        warnings: [],
      }),
    }),
    middleware: reasoningAsJsonTextMiddleware,
  });
}

const schema = z.object({ stance: z.enum(["critical", "neutral", "favorable"]) });

describe("reasoningAsJsonTextMiddleware (LM Studio bug #1990 workaround)", () => {
  it("recovers a structured answer that LM Studio filed under reasoning", async () => {
    const model = lmstudioLike([{ type: "reasoning", text: '{"stance":"critical"}' }]);
    const { output } = await generateText({
      model,
      prompt: "p",
      output: Output.object({ schema }),
    });
    expect(output).toEqual({ stance: "critical" });
  });

  it("keeps real text when the model returned some", async () => {
    const model = lmstudioLike([
      { type: "reasoning", text: "thinking out loud" },
      { type: "text", text: '{"stance":"neutral"}' },
    ]);
    const { output } = await generateText({
      model,
      prompt: "p",
      output: Output.object({ schema }),
    });
    expect(output).toEqual({ stance: "neutral" });
  });

  it("never turns reasoning into the answer for free-text calls", async () => {
    const model = lmstudioLike([{ type: "reasoning", text: "private chain of thought" }]);
    const { text } = await generateText({ model, prompt: "p" });
    expect(text).toBe("");
  });
});

// A mock that answers successive calls from a list, wrapped like registry.ts
// wraps LM Studio models (retry outside, reasoning recovery inside).
function sequenced(answers: Content[]) {
  let calls = 0;
  const model = wrapLanguageModel({
    model: new MockLanguageModelV4({
      doGenerate: async () => ({
        content: answers[Math.min(calls++, answers.length - 1)] ?? [],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 1, text: 1, reasoning: undefined },
        },
        warnings: [],
      }),
    }),
    middleware: [retryUnenforcedJsonMiddleware, reasoningAsJsonTextMiddleware],
  });
  return { model, calls: () => calls };
}

describe("retryUnenforcedJsonMiddleware (structured output skipped after a plain request)", () => {
  it("retries once when the schema was not applied, and uses the second answer", async () => {
    const { model, calls } = sequenced([
      [{ type: "text", text: '{Reaction 1: stance "critical"}' }], // not even JSON
      [{ type: "text", text: '{"stance":"critical"}' }],
    ]);
    const { output } = await generateText({
      model,
      prompt: "p",
      output: Output.object({ schema }),
    });
    expect(output).toEqual({ stance: "critical" });
    expect(calls()).toBe(2);
  });

  it("retries when the JSON lacks the schema's required top-level keys", async () => {
    const { model, calls } = sequenced([
      [{ type: "text", text: '{"7fe30d71":{"stance":"critical"}}' }],
      [{ type: "text", text: '{"stance":"neutral"}' }],
    ]);
    const { output } = await generateText({
      model,
      prompt: "p",
      output: Output.object({ schema }),
    });
    expect(output).toEqual({ stance: "neutral" });
    expect(calls()).toBe(2);
  });

  it("does not retry a conforming answer, including one recovered from reasoning", async () => {
    const { model, calls } = sequenced([[{ type: "reasoning", text: '{"stance":"favorable"}' }]]);
    const { output } = await generateText({
      model,
      prompt: "p",
      output: Output.object({ schema }),
    });
    expect(output).toEqual({ stance: "favorable" });
    expect(calls()).toBe(1);
  });

  it("never retries free-text calls", async () => {
    const { model, calls } = sequenced([[{ type: "text", text: "just a reaction" }]]);
    await generateText({ model, prompt: "p" });
    expect(calls()).toBe(1);
  });
});
