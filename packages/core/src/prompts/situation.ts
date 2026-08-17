// Situation framing (channel context). Layered onto the persona system prompt to
// change the heat and register of the voice depending on *where* the persona is
// speaking. Design rules, carried over from production tuning:
//
//   - Never order the persona to be hostile. Anonymous-board etc. unlock candor
//     through context role-play, not through a "be toxic" instruction.
//   - Always include an "if you genuinely feel that way" guard so criticism is
//     never forced on everyone (without it, ~all personas turn critical and the
//     backlash index saturates — observed failure mode).
//   - Allow "a curt one-liner if it doesn't land" so heat and length spread out.
//   - Country-aware flavor: an "anonymous board" is a different place per country
//     (JP=5ch, US=4chan/Reddit, FR=jeuxvideo.com, ...). When the country is known,
//     CHANNEL_CULTURE injects a short venue example + one line of temperament.
//     Unregistered country x channel cells fall back to the generic prose.

import { DEFAULT_SITUATION, type LengthPolicy, SITUATIONS } from "../data/situations";
import type { Country, PersonaLang, Situation } from "../types";

export { DEFAULT_SITUATION };

// Render the situation's length-policy token into a concrete phrase.
// Anonymous boards allow rants; surveys cap at two sentences.
export function lengthClause(situation: Situation, ja: boolean): string {
  const policy: LengthPolicy = SITUATIONS[situation].lengthPolicy;
  if (ja) {
    switch (policy) {
      case "two":
        return "2文以内で";
      case "one_two":
        return "1〜2文で";
      case "two_three":
        return "2〜3文で";
      case "free":
        return "長くても短くても構わず、思うままに";
    }
  }
  switch (policy) {
    case "two":
      return "in 2 sentences or fewer";
    case "one_two":
      return "in 1 to 2 sentences";
    case "two_three":
      return "in 2 to 3 sentences";
    case "free":
      return "at whatever length feels natural";
  }
}

// Venue example + temperament, per country x channel. Only the three channels
// with large cultural variance (anon_board / news_comment / sns_viral) have
// country cells; the global-platform channels (real_sns / public_comment /
// consumer_survey) stay generic. Venue names are short factual examples —
// a wrong stereotype would be worse than the generic fallback.
type ChannelCulture = { ja: string; en: string };
const CHANNEL_CULTURE: Partial<Record<Country, Partial<Record<Situation, ChannelCulture>>>> = {
  jp: {
    anon_board: {
      ja: "例えば 5ch や 2ちゃん的な完全匿名スレ。スレッド形式で短いレスが連なり、煽り・茶化し・皮肉が日常的に飛び交います。",
      en: "Picture a fully anonymous Japanese thread board like 5ch (2channel): short replies pile up in a thread, with provocation, mockery and sarcasm as the everyday register.",
    },
    news_comment: {
      ja: "例えば Yahoo! ニュースのコメント欄（ヤフコメ）。正義感や説教、当事者への断罪が出やすい場です。",
      en: "Picture the Yahoo! News comment section: a strong sense of justice, lecturing, and condemnation of those involved come out easily.",
    },
    sns_viral: {
      ja: "引用リツイートでの晒しや皮肉、その場の空気に合わせた同調も出ます。",
      en: "Quote-tweet call-outs and sarcasm, as well as going along with the mood, both show up.",
    },
  },
  usa: {
    anon_board: {
      ja: "例えば 4chan や Reddit の匿名性が高い板。4chan 系は過激で容赦なく、Reddit 系は up/down vote と各 subreddit の不文律に沿って辛辣な本音が出ます。",
      en: "Picture 4chan or the more anonymous corners of Reddit: 4chan-style boards are blunt and merciless, while Reddit runs on up/down-votes and each subreddit's unwritten rules.",
    },
    news_comment: {
      ja: "例えばニュースサイトや YouTube のコメント欄。政治的な対立軸に沿って賛否が割れ、強い言葉で論争になりがちです。",
      en: "Picture the comments on a news site or YouTube: opinions split along political lines and escalate into strongly-worded arguments.",
    },
    sns_viral: {
      ja: "引用ツイートで嘲笑する dunk 文化があり、政治的に二極化した反応になりがちです。",
      en: "There's a 'dunk' culture of quote-tweeting to ridicule, and reactions tend to polarize politically.",
    },
  },
  fr: {
    anon_board: {
      ja: "例えば jeuxvideo.com の 18-25 板や Reddit France。若年層中心で言葉が荒く、皮肉（second degré）と決めつけが強く出ます。",
      en: "Picture jeuxvideo.com's 18-25 forum or Reddit France: young, coarse, heavy on irony (second degré) and snap judgments.",
    },
    news_comment: {
      ja: "例えばニュースサイトのコメント欄。制度や政治への辛辣な批判と、論評めいた物言いが出やすい場です。",
      en: "Picture the comments under a news article: sharp criticism of institutions and politics, in a commentary-like register.",
    },
    sns_viral: {
      ja: "皮肉（second degré）と、政治・社会への論争的な反応が出やすいです。",
      en: "Irony (second degré) and polemical reactions to politics and society come easily.",
    },
  },
  in: {
    anon_board: {
      ja: "例えば Reddit India（r/india）のような匿名性の高い場。英語に Hindi が混じり（Hinglish）、地域・宗教（ヒンドゥー対ムスリム、カースト）・政治の対立線に沿って一気に過熱します。",
      en: "Picture an anonymous-leaning space like Reddit India (r/india): English mixed with Hindi (Hinglish), heating up fast along regional, religious (Hindu–Muslim, caste) and political fault lines.",
    },
    news_comment: {
      ja: "例えば Times of India などニュースサイトや YouTube のコメント欄。政治的に強く二極化し、ナショナリズムや宗教感情が出やすい場です。",
      en: "Picture the comments on a site like the Times of India or on YouTube: strongly polarized politically, with nationalism and religious sentiment surfacing easily.",
    },
    sns_viral: {
      ja: "X はインドで巨大な戦場。政治的に二極化し、組織的なトロールやハッシュタグ動員、英語と Hindi の混在が見られます。",
      en: "X is a massive battleground in India — politically polarized, with organized trolling, hashtag mobilization, and a mix of English and Hindi.",
    },
  },
  br: {
    anon_board: {
      ja: "例えば Reddit Brasil（r/brasil）のような場。ふざけ倒す『zueira』のノリとミーム、政治的二極化（ルラ対ボルソナロ）がポルトガル語で噴き出します。",
      en: "Picture a space like Reddit Brasil (r/brasil): irreverent 'zueira' humor and memes, with political polarization (Lula vs Bolsonaro), all in Portuguese.",
    },
    news_comment: {
      ja: "例えば G1 や UOL などニュースサイトや YouTube のコメント欄。政治的に強く割れ、感情的で辛辣な応酬になりがちです。",
      en: "Picture the comments on a news site like G1 or UOL, or on YouTube: sharply split politically, emotional, and often caustic.",
    },
    sns_viral: {
      ja: "X はブラジルで非常に活発。ユーモアとミーム、政治的二極化が混ざり、『zueira não tem limite（悪ふざけに限界なし）』のノリが出ます。",
      en: "X is highly active in Brazil — humor and memes blend with political polarization, in the spirit of 'zueira não tem limite' (the trolling knows no limits).",
    },
  },
  kr: {
    anon_board: {
      ja: "例えば DCインサイド や エフエムコリア のような完全匿名コミュニティ。ミームと『드립（ネタ）』が飛び交い、男女対立や政治対立が極端に先鋭化します。",
      en: "Picture fully anonymous communities like DCInside or FM Korea: memes and wordplay ('drip') fly, and gender and political conflicts get extremely sharp.",
    },
    news_comment: {
      ja: "例えば Naver / Daum のニュースコメント（네이버 댓글）。影響力が大きく、『기레기（クズ記者）』叩きや政治対立で非常に辛辣になります。",
      en: "Picture Naver/Daum news comments — highly influential, and very harsh, with 'gireogi' (trash-journalist) bashing and political conflict.",
    },
    sns_viral: {
      ja: "X やコミュニティ発の拡散。短く鋭い『드립』と、男女・政治の対立軸に沿った炎上が起きやすいです。",
      en: "Virality on X and from community boards — short, sharp wordplay ('drip'), with flare-ups along gender and political fault lines.",
    },
  },
  vn: {
    anon_board: {
      ja: "例えば voz.vn のフォーラム（『vozer』）。砕けたユーモアと辛辣な本音、時にナショナリズムがベトナム語で出ます。",
      en: "Picture the voz.vn forums (the 'vozers'): casual humor, blunt candor, and at times nationalism, in Vietnamese.",
    },
    news_comment: {
      ja: "例えば VnExpress のコメント欄（賛同が多い順に表示）や Facebook のニュース投稿。率直で皮肉混じりの短評が並びます。",
      en: "Picture VnExpress comments (sorted by most-upvoted) or Facebook news posts: blunt, sometimes sarcastic short takes.",
    },
    sns_viral: {
      ja: "短く率直で、ユーモアやナショナリズムが絡みやすいです。",
      en: "Short and blunt, often laced with humor or nationalism.",
    },
  },
  be: {
    anon_board: {
      ja: "例えば Reddit Belgium（r/belgium）。オランダ語（フランデレン）とフランス語（ワロン）の言語コミュニティの溝が表面化し、比較的冷静だが地域対立は鋭く出ます。",
      en: "Picture Reddit Belgium (r/belgium): the Dutch-speaking (Flemish) and French-speaking (Walloon) community divide surfaces — relatively measured, but the regional split shows sharply.",
    },
    news_comment: {
      ja: "例えば HLN や Le Soir のコメント欄。言語・地域（フランデレン対ワロン）で意見が割れやすく、移民・税の話題で過熱します。",
      en: "Picture comments on HLN or Le Soir: opinions split along language and region (Flanders vs Wallonia), heating up on immigration and taxes.",
    },
    sns_viral: {
      ja: "X 上での拡散。オランダ語とフランス語が混在し、言語・地域の対立軸が反応に影を落とします。",
      en: "Virality on X — Dutch and French mixed, with the language/regional divide coloring reactions.",
    },
  },
};

// Venue example + temperament as one sentence (with trailing space). Empty when unregistered.
function cultureClause(country: Country | undefined, situation: Situation, ja: boolean): string {
  if (!country) return "";
  const c = CHANNEL_CULTURE[country]?.[situation];
  if (!c) return "";
  return `${ja ? c.ja : c.en} `;
}

// The sns_viral venue (the opening "where you are" phrase). Default is X
// (semi-anonymous). Vietnam overrides to Facebook — X is not where virality
// happens there, and keeping it would make the VN voices unnatural. All other
// countries (and unknown) return the default, byte-identical to the generic prose.
const VIRAL_VENUE_DEFAULT: ChannelCulture = {
  ja: "X（旧 Twitter）でこの投稿を目にしました。半匿名のタイムラインで、思ったことを短く投稿します。",
  en: "seeing this post on X (formerly Twitter). On a semi-anonymous timeline you post your gut reaction.",
};
const VIRAL_VENUE: Partial<Record<Country, ChannelCulture>> = {
  vn: {
    ja: "Facebook でこの投稿を目にしました。実名のタイムラインですが、ベトナムでは率直なコメントやシェアで意見が一気に広がります。",
    en: "seeing this post on Facebook. The timeline is real-name, but in Vietnam blunt comments and shares spread opinion fast.",
  },
};
function viralVenue(country: Country | undefined, ja: boolean): string {
  const v = (country && VIRAL_VENUE[country]) || VIRAL_VENUE_DEFAULT;
  return ja ? v.ja : v.en;
}

export function getSituationFraming(
  situation: Situation,
  personaLang: PersonaLang,
  country?: Country,
): string {
  // consumer_survey = the measured baseline; no channel block (system extra only).
  if (situation === "consumer_survey") return "";
  const ja = personaLang === "ja";
  const culture = cultureClause(country, situation, ja);
  switch (situation) {
    case "sns_viral": {
      const venue = viralVenue(country, ja);
      return ja
        ? `\n\nあなたは今、${venue}${culture}賛同なら称賛や拡散、引っかかれば率直な批判や皮肉も出ます——人は SNS では普段より遠慮なく本音を書きます。あなたが本当にそう感じるなら、その温度のまま。心底どうでもよければ、そっけない一言で済ませます。取り繕わないこと。`
        : `\n\nYou are ${venue} ${culture}If you agree you praise or amplify it; if something bothers you, blunt criticism or sarcasm comes out — people speak more freely on social media than face to face. If you genuinely feel that way, keep that temperature. If you truly don't care, a curt one-liner is fine. Don't dress it up.`;
    }
    case "anon_board":
      return ja
        ? `\n\nあなたは今、完全匿名の掲示板でこのスレを開きました。${culture}名前も身元も一切出ません。だから普段は社会的体裁で飲み込む本音も、ここでは遠慮なく書きます。面白がる・茶化す・煽る・突き放す——あなたが本当にそう感じるなら、ネット民の素の口調で書いてください。逆に心底どうでもよければ、ひと言だけ。綺麗にまとめようとしないこと。`
        : `\n\nYou just opened this thread on a fully anonymous message board. ${culture}No name, no identity is shown, so the honest reactions you'd normally swallow for the sake of appearances, you write freely here. Joke, mock, provoke, dismiss — if you genuinely feel that way, write in the raw voice of an anonymous netizen. If you truly couldn't care less, just a few words. Don't tidy it up.`;
    case "news_comment":
      return ja
        ? `\n\nあなたは今、ニュースサイトのコメント欄でこの話題を読みました。${culture}半匿名で、世間に向けて自分の考えを表明します。正義感・常識・説教めいた断罪が出やすい場です。賛否どちらでも、あなたの価値観に照らして遠慮なく。ただし掲示板ほど砕けず、ニュースに物申すトーンで。`
        : `\n\nYou are reading this in the comment section of a news site. ${culture}Semi-anonymously, you state your view to the public. It's a place where a sense of justice, common-sense moralizing, and sermon-like condemnation come easily. For or against, speak freely against your own values — but less rowdy than a message board, in the tone of someone weighing in on the news.`;
    case "real_sns":
      return ja
        ? "\n\nあなたは今、実名の SNS（Facebook / LinkedIn 等）でこの投稿を見ています。あなたの名前が残り、職場や知人にも見られます。だから本音でも、建設的で配慮ある言い方を選びます。良ければ前向きに評価し、懸念があっても角を立てずに具体的に指摘します。"
        : "\n\nYou are seeing this post on a real-name network (Facebook / LinkedIn). Your name is attached and colleagues and acquaintances can see it. So even when candid, you choose a constructive, considerate phrasing. Praise what works; if something concerns you, name it specifically but without hostility.";
    case "public_comment":
      return ja
        ? "\n\nあなたは今、行政が募集したパブリックコメントにこの案件について意見を提出しています。記名または半記名で、公的な記録に残ります。影響を受ける当事者の立場なら、賛成・反対・要望・懸念を理由とともに述べます。陳情・抗議・支持、いずれもあなたの立場に正直に。"
        : "\n\nYou are submitting a public comment to a government consultation on this matter. Named or semi-named, it goes into the public record. As someone affected, you state support, opposition, requests, or concerns with reasons. Petition, protest, or endorsement — be honest to your position.";
    default:
      return "";
  }
}
