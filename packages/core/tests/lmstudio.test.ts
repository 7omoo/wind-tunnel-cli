import { generateText, Output, wrapLanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { reasoningAsJsonTextMiddleware } from "../src/lmstudio/reasoning-workaround";

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
