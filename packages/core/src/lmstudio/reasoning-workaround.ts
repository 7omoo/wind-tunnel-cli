// Workaround for thinking models served by LM Studio.
//
// TODO(lmstudio-bug-tracker#1990): remove this middleware once LM Studio honors
// `chat_template_kwargs.enable_thinking: false` on its OpenAI-compatible API.
// https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/1990
//
// The bug: thinking cannot be turned off per request, and on a structured-output
// call the server files the whole grammar-constrained answer under
// `reasoning_content`, leaving `content` empty (observed with Qwen3.5-4B on
// LM Studio 0.4.x). The constrained tokens are the JSON answer itself, so for
// JSON calls only, an empty text part is replaced by the reasoning text; the
// pipeline's schema validation still checks it. Free-text calls (persona
// reactions) are never touched — non-thinking models avoid the issue entirely
// and are the recommended choice (docs/commands.md).

import type { LanguageModelMiddleware } from "ai";

export const reasoningAsJsonTextMiddleware: LanguageModelMiddleware = {
  wrapGenerate: async ({ doGenerate, params }) => {
    const result = await doGenerate();
    if (params.responseFormat?.type !== "json") return result;

    const hasText = result.content.some((part) => part.type === "text" && part.text.trim() !== "");
    if (hasText) return result;

    const reasoning = result.content
      .flatMap((part) => (part.type === "reasoning" ? [part.text] : []))
      .join("");
    if (reasoning.trim() === "") return result;

    return {
      ...result,
      content: [
        ...result.content.filter((part) => part.type !== "reasoning"),
        { type: "text", text: reasoning },
      ],
    };
  },
};
