import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseLLMJson, parseLLMJsonChecked } from "../src/util/llm-json";

describe("parseLLMJson", () => {
  it("parses plain JSON", () => {
    expect(parseLLMJson('{"a": 1}')).toEqual({ a: 1 });
  });

  it("strips ```json fences that models attach despite instructions", () => {
    expect(parseLLMJson('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(parseLLMJson("```\n[1, 2]\n```")).toEqual([1, 2]);
  });

  it("throws on a broken body — malformed JSON stays a hard error", () => {
    expect(() => parseLLMJson("```json\n{oops\n```")).toThrow();
  });
});

describe("parseLLMJsonChecked", () => {
  const schema = z.object({ count: z.number() });

  it("reports valid:true when the schema matches", () => {
    expect(parseLLMJsonChecked('{"count": 3}', schema)).toEqual({
      data: { count: 3 },
      valid: true,
    });
  });

  it("returns the raw parse with valid:false on drift instead of throwing", () => {
    const r = parseLLMJsonChecked('{"count": "three"}', schema);
    expect(r.valid).toBe(false);
    expect(r.data).toEqual({ count: "three" }); // raw, not coerced or dropped
    expect(r.error).toBeTruthy();
  });
});
