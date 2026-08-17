// Strip markdown code fences (```json ... ``` / ``` ... ```) from LLM output and
// JSON.parse it. Many models attach fences on a whim even when the system prompt
// says "JSON only". With constrained decoding (Ollama `format`) this becomes a
// near no-op, but it stays as the safety net for providers without it.

import type { ZodType } from "zod";

// The return value is a raw cast (trusting the caller's T). Actual validation
// happens in parseLLMJsonChecked or via safeParse at the call site.
export function parseLLMJson<T = unknown>(text: string): T {
  const stripped = text
    .replace(/```json?\n?/g, "")
    .replace(/```/g, "")
    .trim();
  return JSON.parse(stripped) as T;
}

// parseLLMJson + observational Zod validation. `data` is always the raw parse
// result (schema defaults/coercions are NOT applied to it); schema mismatch
// yields valid:false instead of throwing, so callers can continue on drift and
// log it. A broken JSON body (JSON.parse failure) still throws — that remains a
// hard error for the caller to handle.
export function parseLLMJsonChecked<T = unknown>(
  text: string,
  schema: ZodType,
): { data: T; valid: boolean; error?: unknown } {
  const data = parseLLMJson<T>(text);
  const result = schema.safeParse(data);
  return result.success ? { data, valid: true } : { data, valid: false, error: result.error };
}
