import { describe, expect, it } from "vitest";
import { reactPersonas } from "../src/pipeline/react";
import type { Opinion } from "../src/types";
import { FIXTURE_PERSONAS_JP } from "./fixtures/personas-jp";
import { failingModel, flakyModel, textModel } from "./helpers/mock-model";

const base = {
  topic: "新商品のお知らせ",
  country: "jp" as const,
  situation: "consumer_survey" as const,
  personaLang: "ja" as const,
  concurrency: 3,
};

async function collect(
  gen: AsyncGenerator<Opinion, { requested: number; succeeded: number; failed: number }>,
) {
  const opinions: Opinion[] = [];
  let result = await gen.next();
  while (!result.done) {
    opinions.push(result.value);
    result = await gen.next();
  }
  return { opinions, summary: result.value };
}

describe("reactPersonas", () => {
  it("yields one opinion per persona with attributes and extracted name", async () => {
    const personas = FIXTURE_PERSONAS_JP.slice(0, 5);
    const model = textModel(["良いと思います。"]);
    const { opinions, summary } = await collect(reactPersonas({ ...base, personas, model }));
    expect(opinions).toHaveLength(5);
    expect(summary).toEqual({ requested: 5, succeeded: 5, failed: 0 });
    expect(model.calls()).toBe(5);
    const ids = new Set(opinions.map((o) => o.personaId));
    expect(ids.size).toBe(5);
    const one = opinions.find((o) => o.personaId === "jp-001");
    if (one) {
      // jp name extraction cuts before "は".
      expect(one.name).toBe("田中太郎");
      expect(one.attributes.occupation).toBe("ソフトウェアエンジニア");
      expect(one.attributes.location).toBe("東京都");
    }
  });

  it("counts partial failures without throwing", async () => {
    const personas = FIXTURE_PERSONAS_JP.slice(0, 6);
    const model = flakyModel((call) => call % 2 === 1, "まあまあですね。");
    const { opinions, summary } = await collect(reactPersonas({ ...base, personas, model }));
    expect(summary.requested).toBe(6);
    expect(summary.succeeded).toBe(3);
    expect(summary.failed).toBe(3);
    expect(opinions).toHaveLength(3);
  });

  it("throws when every reaction fails (fail-closed)", async () => {
    const personas = FIXTURE_PERSONAS_JP.slice(0, 4);
    const gen = reactPersonas({ ...base, personas, model: failingModel("daemon down") });
    await expect(collect(gen)).rejects.toThrow(/all 4 persona reactions failed.*daemon down/);
  });

  it("embeds the persona prose and topic in the prompts", async () => {
    const personas = [FIXTURE_PERSONAS_JP[0]!];
    const prompts: string[] = [];
    const model = textModel((prompt) => {
      prompts.push(prompt);
      return "なるほど。";
    });
    await collect(reactPersonas({ ...base, personas, model, context: "参考資料です" }));
    const joined = prompts.join("\n");
    expect(joined).toContain("新商品のお知らせ");
    expect(joined).toContain("田中太郎"); // persona system prompt
    expect(joined).toContain("参考資料です"); // manual context block
  });
});
