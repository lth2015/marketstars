// 演示/测试环境种子数据。全部为 MarketStars 原创的合成数据，生产环境不要执行。
// 由 prisma/seed.ts（命令行）和演示模式下的「重置演示数据」共用。
import type { PrismaClient } from "@prisma/client";
import { buildSearchText, derivePricing } from "./catalog";
import { addOneMonthJst } from "./time";
import { appMockups } from "./demo-mockups";

const days = (n: number) => new Date(Date.now() - n * 86400000);

const categories = [
  ["marketing", "マーケティング・コンテンツ"],
  ["analytics", "売上分析"],
  ["crm", "顧客管理・CRM"],
  ["support", "接客・電話対応"],
  ["office", "書類・事務"],
  ["store-ops", "店舗運営"],
  ["other", "その他"],
];
const industries = [
  ["retail", "小売"],
  ["restaurant", "飲食"],
  ["beauty", "美容・サービス"],
  ["general", "業種共通"],
];
const integrations = [
  ["standalone", "単体で利用"],
  ["starpay", "StarPay連携"],
];

type PlanSeed = { key: string; name: string; type: "free" | "monthly" | "contact"; price?: number; trial?: number; includes: string; limits?: string; ext?: boolean; token?: number };
type AppSeed = {
  slug: string; name: string; tagline: string; provider: string; cats: string[]; inds: string[]; integ: string[]; tags: string;
  weight: number; publishedDaysAgo: number; plans: PlanSeed[]; integrated?: boolean; color: string; glyph: string;
};

const apps: AppSeed[] = [
  { slug: "pop-writer", name: "AI POPメーカー", tagline: "商品名と特徴を入れるだけで、店頭POPやSNS投稿の文案を数パターン作成します。", provider: "MarketStars Labs", cats: ["marketing"], inds: ["retail", "restaurant", "general"], integ: ["standalone"], tags: "POP SNS 文章 作成 キャッチコピー", weight: 100, publishedDaysAgo: 12, integrated: true, color: "#185ABD", glyph: "P",
    plans: [{ key: "free", name: "フリー", type: "free", includes: "月30回まで生成\n2パターン同時生成", limits: "商用利用可・履歴保存なし" }, { key: "standard", name: "スタンダード", type: "monthly", price: 1980, trial: 14, includes: "生成回数 無制限\n5パターン同時生成\nトーン指定\nAIモデル提案（従量）", limits: "1空間あたりの料金です", token: 3000 }] },
  { slug: "review-reply", name: "クチコミ返信アシスタント", tagline: "Googleマップなどのクチコミに、お店らしい丁寧な返信案をAIが提案します。", provider: "Hikari Works", cats: ["crm", "marketing"], inds: ["restaurant", "beauty"], integ: ["standalone"], tags: "口コミ レビュー 返信", weight: 90, publishedDaysAgo: 40, integrated: true, color: "#0F7B6C", glyph: "口",
    plans: [{ key: "basic", name: "ベーシック", type: "monthly", price: 2980, trial: 30, token: 2000, includes: "返信案 月200件\n店舗トーン学習" }] },
  { slug: "sales-insight", name: "売上インサイトAI", tagline: "日々の売上データから、曜日・時間帯ごとの傾向と打ち手を毎朝レポートします。", provider: "Ginza Data", cats: ["analytics"], inds: ["retail", "restaurant"], integ: ["starpay"], tags: "売上 分析 レポート 予測", weight: 80, publishedDaysAgo: 70, color: "#7A4CC2", glyph: "売",
    plans: [{ key: "lite", name: "ライト", type: "monthly", price: 3300, trial: 14, includes: "日次レポート\n週次サマリー" }, { key: "pro", name: "プロ", type: "monthly", price: 9800, includes: "需要予測\n複数店舗比較\nCSV出力", ext: false }] },
  { slug: "phone-concierge", name: "AI電話受付", tagline: "営業時間外や混雑時の電話にAIが応答し、予約・問い合わせ内容を要約して通知します。", provider: "Koe Tech", cats: ["support"], inds: ["restaurant", "beauty"], integ: ["standalone"], tags: "電話 予約 受付 自動応答", weight: 70, publishedDaysAgo: 8, color: "#C2410C", glyph: "電",
    plans: [{ key: "standard", name: "スタンダード", type: "monthly", price: 5500, trial: 7, includes: "月100通話\n要約メール通知", ext: true, limits: "電話番号の発行は提供会社と別途契約" }, { key: "enterprise", name: "多店舗向け", type: "contact", includes: "通話数・店舗数に応じて個別見積" }] },
  { slug: "shift-planner", name: "シフト作成AI", tagline: "スタッフの希望と売上予測から、人件費を抑えたシフト案を自動で作ります。", provider: "Sakura Systems", cats: ["store-ops"], inds: ["retail", "restaurant", "general"], integ: ["standalone"], tags: "シフト 勤怠 人件費", weight: 60, publishedDaysAgo: 120, color: "#0E7490", glyph: "シ",
    plans: [{ key: "free", name: "フリー", type: "free", includes: "スタッフ5名まで" }, { key: "team", name: "チーム", type: "monthly", price: 4400, trial: 30, includes: "スタッフ無制限\n売上連動" }] },
  { slug: "receipt-clerk", name: "経費・レシート読み取り", tagline: "レシートや請求書を撮影するだけで、勘定科目付きの経費データに整理します。", provider: "Ledger Bridge", cats: ["office"], inds: ["general"], integ: ["standalone"], tags: "経費 レシート OCR 会計 インボイス", weight: 0, publishedDaysAgo: 3, color: "#4D7C0F", glyph: "経",
    plans: [{ key: "free", name: "フリー", type: "free", includes: "月20枚まで" }, { key: "plus", name: "プラス", type: "monthly", price: 1100, includes: "月300枚\n会計ソフト向けCSV" }] },
  { slug: "menu-translator", name: "メニュー多言語化AI", tagline: "メニューや店内掲示を英語・中国語・韓国語に翻訳し、印刷用データを作成します。", provider: "Hikari Works", cats: ["marketing", "store-ops"], inds: ["restaurant"], integ: ["standalone"], tags: "翻訳 インバウンド 多言語 メニュー", weight: 50, publishedDaysAgo: 25, color: "#BE185D", glyph: "訳",
    plans: [{ key: "free", name: "フリー", type: "free", includes: "月3ページまで" }] },
  { slug: "customer-notes", name: "顧客カルテAI", tagline: "施術や接客メモを音声で残すと、次回来店時に要点をまとめて表示します。", provider: "Beauty Link", cats: ["crm"], inds: ["beauty"], integ: ["starpay"], tags: "カルテ 顧客 音声 メモ", weight: 40, publishedDaysAgo: 55, color: "#9333EA", glyph: "顧",
    plans: [{ key: "salon", name: "サロン", type: "monthly", price: 2200, trial: 14, includes: "顧客1,000名まで\n音声メモ 月300件" }] },
  { slug: "inventory-alert", name: "在庫アラート", tagline: "売れ行きから欠品しそうな商品を予測し、発注のタイミングをお知らせします。", provider: "Ginza Data", cats: ["store-ops", "analytics"], inds: ["retail"], integ: ["starpay"], tags: "在庫 発注 欠品 予測", weight: 0, publishedDaysAgo: 18, color: "#0369A1", glyph: "在",
    plans: [{ key: "standard", name: "スタンダード", type: "monthly", price: 2750, includes: "SKU 2,000まで\nLINE通知" }] },
  { slug: "faq-bot", name: "店舗FAQチャット", tagline: "営業時間・駐車場・アレルギーなどのよくある質問に、Webサイト上で自動回答します。", provider: "Koe Tech", cats: ["support"], inds: ["general"], integ: ["standalone"], tags: "チャットボット FAQ 問い合わせ", weight: 30, publishedDaysAgo: 90, color: "#B45309", glyph: "Q",
    plans: [{ key: "free", name: "フリー", type: "free", includes: "月100回答" }, { key: "business", name: "ビジネス", type: "monthly", price: 3980, trial: 14, includes: "回答無制限\n有人切替" }] },
  { slug: "contract-check", name: "契約書チェック補助", tagline: "取引先との契約書をアップロードすると、確認すべき条項を一覧にします。", provider: "Ledger Bridge", cats: ["office"], inds: ["general"], integ: ["standalone"], tags: "契約書 リーガル 確認", weight: 0, publishedDaysAgo: 150, color: "#334155", glyph: "契",
    plans: [{ key: "enterprise", name: "法人", type: "contact", includes: "利用量に応じて個別見積" }] },
  { slug: "event-planner", name: "販促カレンダーAI", tagline: "季節行事や地域イベントに合わせた販促アイデアと実施スケジュールを提案します。", provider: "MarketStars Labs", cats: ["marketing"], inds: ["retail", "restaurant", "beauty"], integ: ["standalone"], tags: "販促 キャンペーン 季節 イベント", weight: 20, publishedDaysAgo: 5, color: "#15803D", glyph: "販",
    plans: [{ key: "free", name: "フリー", type: "free", includes: "月5件の提案" }, { key: "plus", name: "プラス", type: "monthly", price: 980, trial: 7, includes: "提案無制限\n画像付きプラン" }] },
];

function icon(color: string, glyph: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="28" fill="${color}"/><text x="64" y="84" font-size="60" font-family="Noto Sans JP, sans-serif" font-weight="700" fill="#fff" text-anchor="middle">${glyph}</text></svg>`;
  return "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
}

/** 清空业务数据并写入演示数据；返回应用数。会删除所有会话（使用者需要重新登录）。 */
export async function seedDemo(prisma: PrismaClient): Promise<number> {
  await prisma.$transaction([
    prisma.demoAppReviewDraft.deleteMany(), prisma.starpayStatement.deleteMany(), prisma.starpayLink.deleteMany(), prisma.deletionRequest.deleteMany(), prisma.rateLimit.deleteMany(), prisma.webhookDelivery.deleteMany(), prisma.webhookEndpoint.deleteMany(), prisma.domainEvent.deleteMany(), prisma.notificationRead.deleteMany(), prisma.notification.deleteMany(), prisma.emailOutbox.deleteMany(), prisma.tenantContact.deleteMany(), prisma.ledgerAnchor.deleteMany(), prisma.ledgerEntry.deleteMany(), prisma.agentTransaction.deleteMany(), prisma.agentMandate.deleteMany(), prisma.rankingEntry.deleteMany(), prisma.launchTicket.deleteMany(), prisma.usageEvent.deleteMany(), prisma.payoutStatement.deleteMany(), prisma.asset.deleteMany(), prisma.review.deleteMany(), prisma.paymentIntent.deleteMany(), prisma.subscriptionPeriod.deleteMany(), prisma.billingRecord.deleteMany(),
    prisma.applicationRequest.deleteMany(), prisma.subscription.deleteMany(), prisma.trialUsage.deleteMany(), prisma.inquiry.deleteMany(),
    prisma.contentEntry.deleteMany(), prisma.appRelease.deleteMany(), prisma.planVersion.deleteMany(), prisma.app.deleteMany(),
    prisma.provider.deleteMany(), prisma.category.deleteMany(), prisma.industry.deleteMany(), prisma.integrationTag.deleteMany(),
    prisma.operatorGrant.deleteMany(), prisma.auditEvent.deleteMany(), prisma.jobLock.deleteMany(), prisma.session.deleteMany(), prisma.paymentMethod.deleteMany(),
  ]);
  for (const [i, [slug, name]] of categories.entries()) await prisma.category.create({ data: { slug, name, sortOrder: i } });
  for (const [i, [slug, name]] of industries.entries()) await prisma.industry.create({ data: { slug, name, sortOrder: i } });
  for (const [i, [slug, name]] of integrations.entries()) await prisma.integrationTag.create({ data: { slug, name, sortOrder: i } });

  const providers = new Map<string, string>();
  for (const a of apps) {
    if (!providers.has(a.provider)) {
      const p = await prisma.provider.create({ data: { name: a.provider, supportEmail: "support@example.test", ownerTenantId: a.provider === "MarketStars Labs" ? "demo-tenant-labs" : null } });
      providers.set(a.provider, p.id);
    }
  }

  for (const a of apps) {
    const pricing = derivePricing(a.plans.map((p) => ({ priceType: p.type, priceJpy: p.price ?? 0, trialDays: p.trial ?? 0 })));
    const overview = {
      problem: `${a.tagline} 日々の業務にかかる時間を減らし、お客様と向き合う時間を増やします。`,
      features: ["かんたんな初期設定ですぐに使える", "スマートフォン・PCの両方に対応", "空間（店舗）単位で契約し、メンバーで共有"],
      prerequisites: "MarketStars アカウントと、利用する空間（店舗）が必要です。",
      dataNeeds: a.integ.includes("starpay") ? "StarPay の売上データ（読み取りのみ）を利用します。" : "入力した文章のみを処理に利用します。",
      setup: ["MarketStars でお申し込み", "「アプリを開く」から起動", "初回のみ店舗情報を設定"],
      limitations: "AI の出力は参考情報です。公開前に内容をご確認ください。",
    };
    const app = await prisma.app.create({
      data: {
        slug: a.slug, status: "published", name: a.name, tagline: a.tagline, tags: a.tags, providerId: providers.get(a.provider)!,
        searchText: buildSearchText({ name: a.name, tagline: a.tagline, tags: a.tags, providerName: a.provider }),
        iconUrl: icon(a.color, a.glyph), screenshots: appMockups(a.slug, a.name, a.color),
        overview, launchUrl: a.integrated ? `${(process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "")}/integrations/${a.slug}/start` : `https://example.com/apps/${a.slug}`,
        integrationType: a.integrated ? "sso_integrated" : "external", launchClientId: a.integrated ? a.slug : null,
        supportChannels: [{ type: "email", value: "support@example.test" }, { type: "hours", value: "平日 10:00–18:00" }],
        privacyUrl: "/help/privacy", termsUrl: "/help/terms", version: "1.0.0", recommendWeight: a.weight,
        ...pricing, firstPublishedAt: days(a.publishedDaysAgo), contentUpdatedAt: days(Math.min(2, a.publishedDaysAgo)),
        categories: { connect: a.cats.map((slug) => ({ slug })) }, industries: { connect: a.inds.map((slug) => ({ slug })) },
        integrationTags: { connect: a.integ.map((slug) => ({ slug })) },
      },
    });
    for (const [i, p] of a.plans.entries()) {
      await prisma.planVersion.create({ data: { appId: app.id, planKey: p.key, name: p.name, priceType: p.type, priceJpy: p.price ?? 0, trialDays: p.trial ?? 0, includes: p.includes, limits: p.limits ?? "", externalContractRequired: !!p.ext, tokenPriceJpyPerMTok: p.token ?? 0, sortOrder: i } });
    }
    await prisma.appRelease.create({ data: { appId: app.id, number: 1, snapshot: { name: a.name, tagline: a.tagline }, publishedBy: "seed" } });
  }

  // 下书一款未发布草稿，便于演示运营发布流程
  const draft = await prisma.app.create({ data: { slug: "staff-training", status: "draft", name: "スタッフ研修AI", tagline: "接客マニュアルから、ロールプレイ形式の研修を自動で作成します。", providerId: providers.get("MarketStars Labs")!, searchText: "", overview: { problem: "新人研修の準備時間を短縮します。" }, categories: { connect: [{ slug: "store-ops" }] } } });
  await prisma.planVersion.create({ data: { appId: draft.id, planKey: "standard", name: "スタンダード", priceType: "monthly", priceJpy: 1650, trialDays: 14, includes: "研修シナリオ 月20本", limits: "" } });

  // 排行演示用合成开通（测试环境专用；内部测试空间不计入）
  const all = await prisma.app.findMany({ where: { status: "published" }, include: { plans: true } });
  const spread: Record<string, number> = { "pop-writer": 9, "review-reply": 7, "sales-insight": 6, "shift-planner": 5, "menu-translator": 4, "faq-bot": 3, "phone-concierge": 2, "event-planner": 2 };
  for (const a of all) {
    const n = spread[a.slug] ?? 0;
    const plan = a.plans.find((p) => p.priceType === "free") ?? a.plans[0];
    for (let i = 0; i < n; i++) {
      const tenantId = `synthetic-tenant-${i}`;
      const kind = plan.priceType === "free" ? "free" : "paid";
      const started = days(1 + ((i * 3) % 25));
      await prisma.subscription.create({ data: { tenantId, tenantName: `合成テスト店舗${i}`, appId: a.id, planVersionId: plan.id, kind, status: "active", liveKey: `${tenantId}:${a.id}`, priceJpySnapshot: plan.priceJpy, planNameSnapshot: plan.name, startedAt: started, currentPeriodStart: started, currentPeriodEnd: kind === "paid" ? new Date(started.getTime() + 30 * 86400000) : null, createdBy: "seed" } });
    }
  }

  // ── デモを途中から始められるようにする補助データ（すべて合成）──────────────────────
  // MarketStars Labs のアプリには先月の売上を作らない（e2e-p2 G6 が Labs の精算額を検証するため）。
  const bySlug = new Map(all.map((a) => [a.slug, a]));
  const monthly = (slug: string) => bySlug.get(slug)!.plans.find((p) => p.priceType === "monthly")!;
  const paidHistory = async (o: { tenantId: string; tenantName: string; slug: string; months: number; receiptPrefix: string }) => {
    const app = bySlug.get(o.slug)!;
    const plan = monthly(o.slug);
    // 最初の期間開始をおよそ (months-1) か月前に置き、月単位で進める。最後の期間は数日前に始まり、今日を含む。
    const firstStart = days(5 + 30 * (o.months - 1));
    const sub = await prisma.subscription.create({ data: { tenantId: o.tenantId, tenantName: o.tenantName, appId: app.id, planVersionId: plan.id, kind: "paid", status: "active", liveKey: `${o.tenantId}:${app.id}`, priceJpySnapshot: plan.priceJpy, planNameSnapshot: plan.name, startedAt: firstStart, paymentMode: "invoice", createdBy: "seed" } });
    let ps = firstStart;
    for (let i = 0; i < o.months; i++) {
      const pe = addOneMonthJst(ps);
      const bill = await prisma.billingRecord.create({ data: { tenantId: o.tenantId, subscriptionId: sub.id, amountJpy: plan.priceJpy, status: "paid", periodStart: ps, periodEnd: pe, receiptRef: `${o.receiptPrefix}-${i + 1}`, paidAmountJpy: plan.priceJpy, paidAt: ps, confirmedBy: "seed" } });
      await prisma.subscriptionPeriod.create({ data: { subscriptionId: sub.id, kind: "paid", startsAt: ps, endsAt: pe, billingRecordId: bill.id } });
      if (i === o.months - 1) await prisma.subscription.update({ where: { id: sub.id }, data: { currentPeriodStart: ps, currentPeriodEnd: pe } });
      ps = pe;
    }
    return sub;
  };

  // 1) 山田 花子の 3 つ目の空間「ひかり整骨院」：有料（請求書払い・3か月分の入金履歴）、無料、無料体験中
  const hikari = { tenantId: "demo-tenant-hikari", tenantName: "ひかり整骨院" };
  // ひかり整骨院は StarPay 加盟店：有料プランを StarPay の利用料と合算して申し込める
  await prisma.starpayLink.create({ data: { tenantId: hikari.tenantId, merchantId: "SP20240611", merchantName: "StarPay 加盟店 0611", linkedBy: "demo0000000000000000000000000001" } });
  await paidHistory({ ...hikari, slug: "review-reply", months: 3, receiptPrefix: "DEMO-HIKARI-RR" });
  const mt = bySlug.get("menu-translator")!;
  const mtFree = mt.plans.find((p) => p.priceType === "free")!;
  await prisma.subscription.create({ data: { ...hikari, appId: mt.id, planVersionId: mtFree.id, kind: "free", status: "active", liveKey: `${hikari.tenantId}:${mt.id}`, priceJpySnapshot: 0, planNameSnapshot: mtFree.name, startedAt: days(20), createdBy: "seed" } });
  const sp = bySlug.get("shift-planner")!;
  const spPaid = monthly("shift-planner");
  await prisma.trialUsage.create({ data: { tenantId: hikari.tenantId, appId: sp.id, startedAt: days(27) } });
  await prisma.subscription.create({ data: { ...hikari, appId: sp.id, planVersionId: spPaid.id, kind: "trial", status: "trialing", liveKey: `${hikari.tenantId}:${sp.id}`, priceJpySnapshot: 0, planNameSnapshot: spPaid.name, startedAt: days(27), trialEndsAt: new Date(Date.now() + 3 * 86400000), createdBy: "seed" } });

  // 2) 運営 KPI の推移グラフ用：過去数か月の有料契約と入金（30日より前に開始するので利用開始ランキングには影響しない）
  const history: [string, number][] = [["customer-notes", 5], ["sales-insight", 4], ["review-reply", 4], ["shift-planner", 3], ["customer-notes", 2], ["sales-insight", 2]];
  for (const [i, [slug, months]] of history.entries()) {
    const sub = await paidHistory({ tenantId: `history-tenant-${i}`, tenantName: `合成店舗H${i}`, slug, months, receiptPrefix: `DEMO-H${i}` });
    // 直近の2件は無料体験から有料へ切り替えた店舗（体験→有料の転換率に反映される）
    if (months === 2) await prisma.trialUsage.create({ data: { tenantId: sub.tenantId, appId: sub.appId, startedAt: new Date(sub.startedAt!.getTime() - 14 * 86400000) } });
  }

  // 3) 運営の処理待ち：請求書払いのお申し込み 2 件（e2e が使う売上インサイトAI・顧客カルテAI以外）
  for (const [i, slug] of ["inventory-alert", "phone-concierge"].entries()) {
    const a = bySlug.get(slug)!;
    const plan = monthly(slug);
    const tenantId = `pending-tenant-${i}`;
    const sub = await prisma.subscription.create({ data: { tenantId, tenantName: ["にじいろ酒店", "こもれび歯科"][i], appId: a.id, planVersionId: plan.id, kind: "paid", status: "pending", liveKey: `${tenantId}:${a.id}`, priceJpySnapshot: plan.priceJpy, planNameSnapshot: plan.name, paymentMode: "invoice", createdBy: "seed", createdAt: days(1 + i) } });
    await prisma.applicationRequest.create({ data: { subscriptionId: sub.id, tenantId, requestedBy: `pending-user-${i}`, requestedByName: ["小林 一郎", "中村 さち"][i], idempotencyKey: `seed-pending-${i}`, termsVersion: "2026-11-01", agreedAt: days(1 + i), contactNote: ["請求書の宛名：にじいろ酒店 経理担当", null][i] } });
  }

  // 4) お問い合わせ 2 件（未対応・対応中）
  await prisma.inquiry.create({ data: { publicNo: "Q-DEMO-0001", type: "billing", name: "小林 一郎", email: "kobayashi@example.test", company: "にじいろ酒店", appId: bySlug.get("inventory-alert")!.id, message: "請求書払いで申し込みました。振込先と期限を教えてください。", createdAt: days(1) } });
  await prisma.inquiry.create({ data: { publicNo: "Q-DEMO-0002", type: "usage", name: "中村 さち", email: "nakamura@example.test", company: "こもれび歯科", appId: bySlug.get("faq-bot")!.id, message: "よくある質問の登録件数に上限はありますか。", status: "in_progress", assignee: "運営 太郎", note: "提供会社に確認中", createdAt: days(3) } });

  const help = [
    ["getting-started", "はじめての方へ", "MarketStars は、お店の仕事に役立つ AI アプリを探して、すぐに使い始められるアプリマーケットです。\n\n1. アプリ一覧から目的に合うアプリを探します。\n2. 「ログインして利用する」から MarketStars アカウントでログインし、利用する空間（店舗）を選びます。\n3. 無料プランや無料体験はすぐに開始できます。有料プランはお申し込み後、運営が契約とお支払いを確認してから利用開始となります。\n4. 利用中のアプリは「マイアプリ」から開けます。"],
    ["trial", "無料体験について", "無料体験は空間（店舗）ごと・アプリごとに1回までご利用いただけます。\n\n体験期間が終わっても自動で課金されることはありません。続けて利用する場合は、マイアプリまたはアプリ詳細から有料プランをお申し込みください。\n\n体験中はいつでも「体験を終了」できます。"],
    ["apply", "お申し込みと開始", "有料プランのお申し込み後、ステータスは「申込中」になります。運営が契約内容とお支払い（請求書払い・振込）を確認した時点で「利用中」となり、その時刻から1か月が利用期間です。\n\nお申し込みはお支払い完了ではありません。申込中はアプリを利用できません。"],
    ["cancel", "解約・停止", "無料プランの停止はすぐに反映されます。\n\n有料プランの解約は、現在の利用期間の終了時に反映されます。期間終了までは引き続き利用でき、終了前であれば解約を取り消せます。\n\n解約しても MarketStars アカウントは削除されません。アプリ側に保存されたデータの扱いは各アプリのサポートへお問い合わせください。"],
    ["account", "ログアウト・解約・アカウント削除の違い", "・ログアウト：この MarketStars からログアウトします。他のアプリのログインは維持されます。\n・すべての端末からログアウト：共通 SSO の画面で、すべてのアプリ・端末からログアウトします。\n・アプリの解約：空間で契約しているアプリの利用を終了します。アカウントは残ります。\n・アカウント削除：共通 SSO で管理されます。現在はお問い合わせによる受付のみです。"],
    ["support", "サポート窓口", "アプリの使い方は各アプリの提供会社へ、契約・請求については MarketStars 運営へお問い合わせください。お問い合わせフォームから送信すると受付番号が発行されます。"],
  ];
  for (const [i, [slug, title, body]] of help.entries()) await prisma.contentEntry.create({ data: { kind: "help", slug, title, body, sortOrder: i } });
  await prisma.contentEntry.create({ data: { kind: "terms", slug: "terms", title: "MarketStars 利用規約", body: "（デモ版）本規約は MarketStars の利用条件を定めるものです。正式版は運営が確定のうえ掲載します。", version: "2026-11-01" } });
  await prisma.contentEntry.create({ data: { kind: "privacy", slug: "privacy", title: "プライバシーポリシー", body: "（デモ版）MarketStars は、共通 SSO から受け取る利用者 ID・空間 ID を契約管理の目的でのみ利用します。", version: "2026-11-01" } });
  await prisma.contentEntry.create({ data: { kind: "topic", slug: "start-ai", title: "はじめてのAI活用特集", summary: "販促文づくりからクチコミ返信まで、まず試したい3つのアプリ", body: "pop-writer,review-reply,menu-translator", sortOrder: 0 } });
  const pop = all.find((a) => a.slug === "pop-writer")!;
  await prisma.contentEntry.create({ data: { kind: "case", slug: "pop-writer-demo", appId: pop.id, title: "（デモ用サンプル事例）ベーカリーでのPOP作成", summary: "デモ環境向けのサンプルです。実在の導入事例ではありません。", body: "新商品のPOP文案作成にかかっていた時間を短縮するシナリオのサンプルです。" } });

  // 演示评论（合成空间，测试环境专用）
  const sample = [
    ["pop-writer", 5, "POP づくりが早くなりました", "新商品のたびに悩んでいたキャッチコピーが数分で決まるようになりました。"],
    ["pop-writer", 4, "候補が多くて便利", "トーンを変えて何パターンも出せるのが良いです。たまに手直しが必要です。"],
    ["review-reply", 4, "返信の下書きに助かっています", "丁寧な言い回しを提案してくれるので、忙しい時間帯でも返信が続けられています。"],
    ["shift-planner", 3, "設定に少し時間がかかる", "最初の設定は大変でしたが、慣れると毎月のシフト作成が楽になりました。"],
  ] as const;
  for (const [i, [slug, rating, title, body]] of sample.entries()) {
    const a = all.find((x) => x.slug === slug)!;
    await prisma.review.create({ data: { appId: a.id, tenantId: `synthetic-tenant-${i}`, tenantName: `合成テスト店舗${i}`, userId: `synthetic-user-${i}`, userName: `テスト${i}`, rating, title, body } });
  }
  for (const a of all) {
    const agg = await prisma.review.aggregate({ where: { appId: a.id, status: "published" }, _avg: { rating: true }, _count: true });
    if (agg._count) await prisma.app.update({ where: { id: a.id }, data: { ratingAvg: Math.round((agg._avg.rating ?? 0) * 10) / 10, ratingCount: agg._count } });
  }

  await prisma.operatorGrant.create({ data: { userId: "demo0000000000000000000000000009", role: "admin", note: "demo operator" } });
  return apps.length;
}
