import { describe, expect, it } from "vitest";
import { DEFAULT_SITUATION } from "../src/data/situations";
import { getPrompt } from "../src/prompts/persona";
import { getSituationFraming } from "../src/prompts/situation";
import { situationSchema } from "../src/schemas";

// Situation (channel) = where the same persona speaks; it shifts the heat and
// register of the voice without changing who the persona is.

describe("getSituationFraming (channel framing)", () => {
  it("consumer_survey has no framing (the measured baseline = system extra only)", () => {
    expect(getSituationFraming("consumer_survey", "ja")).toBe("");
    expect(getSituationFraming("consumer_survey", "en")).toBe("");
  });

  it("anon_board frames anonymous-board candor (ja=匿名 / en=anonymous)", () => {
    expect(getSituationFraming("anon_board", "ja")).toContain("匿名");
    expect(getSituationFraming("anon_board", "en")).toContain("anonymous");
  });

  it("real_sns frames real-name considerateness (ja=実名 / en=real-name)", () => {
    expect(getSituationFraming("real_sns", "ja")).toContain("実名");
    expect(getSituationFraming("real_sns", "en")).toContain("real-name");
  });

  it("high-anonymity channels always keep the non-coercion guard (prevents all-critical saturation)", () => {
    // Exactly where provocation comes easiest (anon_board / sns_viral) the
    // "if you genuinely feel that way" guard must be present, so criticism is
    // never forced on every persona and diversity isn't clamped.
    for (const s of ["anon_board", "sns_viral"] as const) {
      expect(getSituationFraming(s, "ja")).toContain("本当にそう感じるなら");
      expect(getSituationFraming(s, "en")).toContain("genuinely feel");
    }
  });

  it("mid-heat channels allow both sides (no one-directional forcing)", () => {
    expect(getSituationFraming("news_comment", "ja")).toContain("賛否どちらでも");
    expect(getSituationFraming("news_comment", "en")).toContain("For or against");
  });
});

describe("getSituationFraming country-aware culture (venue examples)", () => {
  it("anon_board injects a country-specific venue example for all 8 countries", () => {
    expect(getSituationFraming("anon_board", "ja", "jp")).toContain("5ch");
    expect(getSituationFraming("anon_board", "en", "usa")).toContain("4chan");
    expect(getSituationFraming("anon_board", "ja", "fr")).toContain("jeuxvideo");
    expect(getSituationFraming("anon_board", "en", "in")).toContain("Reddit India");
    expect(getSituationFraming("anon_board", "en", "br")).toContain("zueira");
    expect(getSituationFraming("anon_board", "en", "kr")).toContain("DCInside");
    expect(getSituationFraming("anon_board", "en", "vn")).toContain("voz");
    expect(getSituationFraming("anon_board", "en", "be")).toContain("Reddit Belgium");
  });

  it("news_comment is also country-aware (jp=ヤフコメ / usa=YouTube)", () => {
    expect(getSituationFraming("news_comment", "ja", "jp")).toContain("Yahoo");
    expect(getSituationFraming("news_comment", "ja", "usa")).toContain("YouTube");
  });

  it("the sns_viral platform is country-aware (default=X / VN=Facebook)", () => {
    // Default countries get X. Vietnam's viral battleground is Facebook, so the
    // opening venue phrase is replaced wholesale.
    expect(getSituationFraming("sns_viral", "en", "jp")).toContain("X (formerly Twitter)");
    expect(getSituationFraming("sns_viral", "en", "vn")).toContain("Facebook");
    expect(getSituationFraming("sns_viral", "en", "vn")).not.toContain("formerly Twitter");
    expect(getSituationFraming("sns_viral", "ja", "vn")).toContain("Facebook");
  });

  it("non-VN sns_viral matches the generic venue exactly (no regression)", () => {
    const undef = getSituationFraming("sns_viral", "ja");
    expect(undef).toContain("X（旧 Twitter）");
    expect(getSituationFraming("sns_viral", "ja", "be")).toContain("X（旧 Twitter）");
  });

  it("unknown country stays generic (no venue name, base context kept)", () => {
    const generic = getSituationFraming("anon_board", "ja");
    expect(generic).not.toContain("5ch");
    expect(generic).toContain("匿名");
  });

  it("unregistered channels (real_sns/public_comment) fall back to generic even with a country", () => {
    // Country cells exist only for the three channels with large cultural
    // variance; global-platform channels stay generic.
    const realSns = getSituationFraming("real_sns", "en", "usa");
    expect(realSns).not.toContain("4chan");
    expect(realSns).not.toContain("Reddit");
    expect(realSns).toContain("real-name");
    expect(getSituationFraming("public_comment", "ja", "jp")).not.toContain("5ch");
  });

  it("consumer_survey stays empty and the non-coercion guard survives country injection", () => {
    expect(getSituationFraming("consumer_survey", "ja", "jp")).toBe("");
    expect(getSituationFraming("anon_board", "ja", "usa")).toContain("本当にそう感じるなら");
  });
});

describe("getPrompt length policy by situation", () => {
  it("consumer_survey caps at two sentences / anon_board is free-length (ja)", () => {
    expect(getPrompt("t", "ja", "consumer_survey")).toContain("2文以内");
    expect(getPrompt("t", "ja", "anon_board")).toContain("思うままに");
  });

  it("en length clauses change the same way", () => {
    expect(getPrompt("t", "en", "consumer_survey")).toContain("2 sentences or fewer");
    expect(getPrompt("t", "en", "anon_board")).toContain("whatever length feels natural");
  });
});

describe("situationSchema fallback", () => {
  it("invalid values fall back to the default (sns_viral)", () => {
    expect(situationSchema.catch(DEFAULT_SITUATION).parse("garbage")).toBe("sns_viral");
    expect(situationSchema.catch(DEFAULT_SITUATION).parse(undefined)).toBe("sns_viral");
  });

  it("valid values pass through", () => {
    expect(situationSchema.catch(DEFAULT_SITUATION).parse("anon_board")).toBe("anon_board");
  });
});
