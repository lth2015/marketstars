import { describe, expect, it } from "vitest";
import { draftReplies } from "@/app/integrations/review-reply/draft";

describe("クチコミ返信アシスタントの返信案", () => {
  it("3 案を作り、署名に店舗名を入れる", () => {
    const d = draftReplies("料理が美味しかったです", 5, "ひかり整骨院", "polite");
    expect(d).toHaveLength(3);
    for (const x of d) expect(x).toContain("ひかり整骨院 スタッフ一同");
  });
  it("高評価は感謝、話題（味）に触れる", () => {
    const d = draftReplies("料理が美味しかったです", 5, "店", "polite");
    expect(d[0]).toContain("お料理を気に入っていただけた");
    expect(d.join()).not.toContain("申し訳");
  });
  it("低評価は最初にお詫び、待ち時間への謝罪と改善の言葉を入れる", () => {
    const d = draftReplies("予約したのにかなり待たされました", 2, "店", "polite");
    expect(d[0].startsWith("貴重なご意見")).toBe(true);
    expect(d[0]).toContain("お待たせしてしまい");
    expect(d[0]).toContain("改善");
  });
  it("簡潔トーンでは署名を省く", () => {
    expect(draftReplies("よかった", 4, "店", "brief")[0]).not.toContain("スタッフ一同");
  });
});

import { __test } from "@/lib/models/gateway";
describe("モデルゲートウェイの mock（API キーなしのデモ用）", () => {
  it("クチコミ返信の依頼には、評価に応じた返信文を返す", () => {
    const low = __test.mockText("クチコミ返信を手伝うアシスタント", "店舗名：ひかり整骨院\n評価：★2\nクチコミ：かなり待たされました");
    expect(low).toContain("お待たせしてしまい");
    expect(low).toContain("ひかり整骨院一同");
    const high = __test.mockText("クチコミ返信を手伝うアシスタント", "店舗名：店\n評価：★5\nクチコミ：最高でした");
    expect(high).toContain("ありがとうございます");
    expect(high).not.toContain("お詫び");
  });
  it("POP コピーの依頼には、商品名と特徴を使った案を返す", () => {
    const t = __test.mockText("販促コピーライター。店頭POP用", "商品：クロワッサン\n特徴：サクサク、焼きたて\nトーン：friendly");
    expect(t).toContain("クロワッサン");
    expect(t).toContain("サクサク");
  });
});

describe("話題ごとの調子", () => {
  it("低評価でも、褒められた話題にはお詫びではなくお礼を返す", () => {
    const d = draftReplies("施術は良かったけど、予約の時間からかなり待たされました。スタッフの対応は丁寧でした。", 2, "店", "polite");
    expect(d[0]).toContain("お待たせしてしまい");
    expect(d[0]).toContain("スタッフの対応にも触れていただき");
    expect(d[0]).not.toContain("スタッフの対応でご不快");
  });
  it("3 案はすべて異なる", () => {
    const d = draftReplies("料理は美味しかったけど待ち時間が長かった", 2, "店", "polite");
    expect(new Set(d).size).toBe(3);
  });
});

describe("English", () => {
  it("English drafts: apology for the wait, thanks for the staff, signed with the store", () => {
    const d = draftReplies("The staff were friendly but we had a long wait.", 2, "Hikari Clinic", "polite", "en");
    expect(d).toHaveLength(3);
    expect(d[0]).toContain("sorry to have kept you waiting");
    expect(d[0]).toContain("kind words about our staff");
    expect(d[0]).toContain("The team at Hikari Clinic");
    expect(new Set(d).size).toBe(3);
  });
  it("the mock model answers English prompts in English", () => {
    const t = __test.mockText("You help a local shop reply to customer reviews.", "Store: Hikari\nRating: 2\nReview: long wait");
    expect(t).toContain("sorry for the long wait");
    expect(t).not.toMatch(/[぀-ヿ]/);
    const p = __test.mockText("You are a promotional copywriter. POP copy", "Product: Croissant\nFeatures: flaky, fresh\nTone: friendly");
    expect(p).toContain("Croissant");
    expect(p).toContain("flaky");
  });
});
