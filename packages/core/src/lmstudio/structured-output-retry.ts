// Workaround for LM Studio skipping structured output after a plain request.
//
// TODO(lmstudio): remove once LM Studio applies response_format to the first
// structured request that follows an unstructured one. Not publicly reported
// as of 2026-10-06; observed on LM Studio 0.4.x with qwen/qwen3-4b-2507.
// Reproduce: send any plain chat completion, then one with
// response_format json_schema — the reply ignores the schema (free text or
// arbitrary JSON); the next identical request conforms. In a run this hits
// the first score call, right after the plain react stage.
//
// For JSON calls only: when the answer is not JSON or lacks the schema's
// required top-level keys, generate once more. The pipeline's schema
// validation still checks whatever comes back.

import type { LanguageModelMiddleware } from "ai";

type GenerateResult = Awaited<ReturnType<NonNullable<LanguageModelMiddleware["wrapGenerate"]>>>;

function answerText(result: GenerateResult): string {
  return result.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
}

// Cheap structural check, enough to tell "schema applied" from "ignored":
// parses as a JSON object carrying every required top-level key.
function looksSchemaShaped(text: string, schema: unknown): boolean {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return false;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const required = (schema as { required?: unknown } | undefined)?.required;
  return (
    !Array.isArray(required) || required.every((key) => typeof key === "string" && key in value)
  );
}

export const retryUnenforcedJsonMiddleware: LanguageModelMiddleware = {
  wrapGenerate: async ({ doGenerate, params }) => {
    const result = await doGenerate();
    if (params.responseFormat?.type !== "json") return result;
    if (looksSchemaShaped(answerText(result), params.responseFormat.schema)) return result;
    return doGenerate();
  },
};
