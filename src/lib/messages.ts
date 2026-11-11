// 面向客户的界面文案（默认日语）。本版本为多语言基础：站点骨架（导航、页脚、主按钮、状态等）提供日 / 英，
// 页面正文仍为日语，后续按页面逐步迁移到这里。
import { cookies } from "next/headers";

export const LOCALES = ["ja", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const LOCALE_COOKIE = "ms_locale";

const ja = {
  brandTagline: "お店の仕事に、ちょうどいいAI。",
  heroLead: "販促、接客、分析、事務まで。店舗のための AI アプリを探して、すぐに試せます。",
  searchPlaceholder: "アプリ名や、解決したいことを検索",
  search: "検索",
  searchShort: "アプリを検索",
  nav: { home: "ホーム", apps: "アプリ一覧", trial: "無料体験", ranking: "ランキング", myApps: "マイアプリ", help: "ヘルプ", admin: "運営管理", menu: "メニュー", main: "メインナビゲーション" },
  login: "ログイン",
  signup: "新規登録",
  logout: "ログアウト",
  space: "空間",
  noSpace: "未選択",
  notifications: "お知らせ",
  unread: (n: number) => `未読 ${n} 件`,
  footer: { help: "ヘルプ", contact: "お問い合わせ", terms: "利用規約", privacy: "プライバシーポリシー", developers: "開発者の方へ", api: "API (OpenAPI)", language: "Language" },
  demoBanner: "デモ環境：演示用の合成データと演示ログインを使用しています（本番では共通 SSO を使用）",
  cta: {
    login: "ログインして利用する",
    free: "無料で利用開始",
    trial: (d: number) => `${d}日間無料で試す`,
    apply: "利用を申し込む",
    pending: "申込状況を確認",
    open: "アプリを開く",
    trialEnded: "プランを申し込む",
    notOwner: "管理者に申し込みを依頼",
    closed: "新規受付停止",
    suspended: "一時停止中",
  },
  ctaNote: {
    suspended: "現在このアプリは一時停止中です。",
    suspendedByOperator: "運営により一時停止されています。",
    closed: "現在、新規のお申し込みを受け付けていません。",
    notOwner: "お申し込みは空間のオーナーのみ可能です。オーナーにご依頼ください。",
  },
  status: { pending: "申込中", trialing: "無料体験中", active: "利用中", cancel_scheduled: "解約予定", expired: "期間終了", canceled: "解約済み", suspended: "一時停止中", rejected: "お申し込み不可", withdrawn: "取り下げ済み" } as Record<string, string>,
  noAutoCharge: "無料体験の終了後に自動で課金されることはありません。続けて利用する場合は有料プランをお申し込みください。",
  perTenant: "1空間あたり／月",
  aggregating: "集計中",
  ui: {
    list: {
      titleAll: "アプリ一覧", titleTrial: "無料体験できるアプリ", titleRecommended: "おすすめのアプリ",
      filters: "絞り込み条件", price: "料金", category: "カテゴリ", industry: "業種", integration: "連携サービス",
      freePlan: "無料プランあり", trialAvail: "無料体験あり", recommended: "おすすめ", apply: "この条件で絞り込む",
      results: "検索結果", count: (n: number) => `${n.toLocaleString("ja-JP")} 件`, removeChip: (l: string) => `${l} の条件を外す`, clearAll: "すべてクリア",
      emptyTitle: "条件に合うアプリが見つかりませんでした", emptyHint: "キーワードを変えるか、絞り込み条件を外してお試しください。", clearFilters: "絞り込み条件をクリア",
      pages: "ページ", prev: "前へ", next: "次へ", filterButton: (n: number) => `絞り込み${n > 0 ? `（${n}）` : ""}`, close: "閉じる",
      sortLabel: "並び順", sortRecommended: "おすすめ順", sortNew: "新着順", sortPrice: "価格の安い順", perPageLabel: "表示件数", perPage: (n: number) => `${n}件`,
    },
    price: { contact: "要問い合わせ", free: "無料", freePlanAvailable: "プランあり", fromPerMonth: "／月（税込）〜", perMonth: "／月（税込）", trialDays: (d: number) => `${d}日間無料体験` },
    badge: { recommended: "おすすめ", isNew: "NEW" },
    home: { topic: "特集", byCategory: "カテゴリから探す", recommended: "おすすめのアプリ", latest: "新着アプリ", ranking: "利用開始ランキング", seeAll: "すべて見る", seeRanking: "ランキングを見る", firstTime: "はじめての方へ", seeHelp: "ヘルプを見る", last30: (n: number) => `直近30日 ${n} 空間` },
    ranking: { title: "利用開始ランキング", basis: "集計方法：直近30日間に新たに利用を開始した空間（店舗）数。無料体験・社内テスト・取り下げ／お申し込み不可は含みません。同じ空間は1アプリにつき1回のみ集計します。1時間ごとに更新。", lastComputed: (d: string) => `最終集計：${d}`, overall: "総合", categories: "カテゴリ", aggregating: "集計中：まだ十分な利用データがありません。現在の件数のみ表示しています。", empty: "このカテゴリのランキングは集計中です。" },
    detail: {
      overview: "概要", plans: "料金プラン", reviews: "レビュー", cases: "導入事例", support: "サポート", inPage: "ページ内",
      solves: "解決できること", features: "主な機能", prerequisites: "利用の前提", dataNeeds: "利用するデータ", setup: "設定の流れ", limitations: "制限事項",
      trialNoAuto: "体験終了後に自動課金はありません", externalContract: "提供会社との別途契約が必要です", noCases: "公開できる導入事例はまだありません。", noScreens: "スクリーンショットは準備中です",
      provider: "提供会社", email: "メール", hours: "受付時間", privacy: "プライバシー", privacyPolicy: "プライバシーポリシー", terms: "利用規約", version: "バージョン", updated: "更新日", ask: "このアプリについて問い合わせる",
      price: "料金", applyingSpace: "申込先の空間：", currentState: "現在の状態：", switchToPaid: "有料プランに切り替える", trialAvail: (d: number) => `${d}日間無料体験あり`,
      externalNotice: "外部サービスです。アプリを開いた後、提供会社のサービスで別途ログインが必要な場合があります。", industries: "対象業種", integrations: "連携",
      enlarge: (alt: string) => `${alt}を拡大`, close: "閉じる", prev: "前へ", next: "次へ", screenshots: "スクリーンショット", tokenPrice: (n: string) => `＋ AI 従量：${n} / 100万トークン（月末締め）`,
      noReviews: "まだレビューはありません。", providerReply: "提供会社からの返信", canReviewHint: "レビューは、この空間でアプリを利用したことのある方が投稿できます。",
    },
    myApps: { title: "マイアプリ", space: "空間", owner: "オーナー", member: "メンバー", switch: "切り替える", billing: "請求・お支払い", agents: "AIエージェント", empty: "この空間で利用中のアプリはまだありません。", findApps: "アプリを探す", groups: { using: "利用中", trial: "無料体験中", pending: "申込中", ended: "終了" }, trialEnds: (d: string) => `体験終了 ${d}`, periodEnds: (d: string) => `期間終了 ${d}`, cancelAt: (d: string) => `解約予定 ${d}`, pendingNote: "運営が契約・お支払いを確認中です", open: "アプリを開く", contract: "契約内容" },
  },
};

export type Messages = typeof ja;

const en: Messages = {
  brandTagline: "AI that fits the way your store works.",
  heroLead: "From promotion and customer service to analytics and paperwork — find AI apps for stores and try them right away.",
  searchPlaceholder: "Search apps or what you want to solve",
  search: "Search",
  searchShort: "Search apps",
  nav: { home: "Home", apps: "All apps", trial: "Free trials", ranking: "Ranking", myApps: "My apps", help: "Help", admin: "Admin", menu: "Menu", main: "Main navigation" },
  login: "Log in",
  signup: "Sign up",
  logout: "Log out",
  space: "Space",
  noSpace: "Not selected",
  notifications: "Notifications",
  unread: (n: number) => `${n} unread`,
  footer: { help: "Help", contact: "Contact", terms: "Terms", privacy: "Privacy", developers: "For developers", api: "API (OpenAPI)", language: "言語" },
  demoBanner: "Demo environment: synthetic data and demo sign-in (production uses the shared SSO)",
  cta: {
    login: "Log in to use",
    free: "Start for free",
    trial: (d: number) => `Try free for ${d} days`,
    apply: "Apply",
    pending: "Check application",
    open: "Open app",
    trialEnded: "Choose a plan",
    notOwner: "Ask your space owner",
    closed: "Not accepting new sign-ups",
    suspended: "Temporarily suspended",
  },
  ctaNote: {
    suspended: "This app is temporarily suspended.",
    suspendedByOperator: "Suspended by the marketplace operator.",
    closed: "New applications are currently closed.",
    notOwner: "Only the space owner can apply. Please ask your owner.",
  },
  status: { pending: "Applied", trialing: "Free trial", active: "Active", cancel_scheduled: "Cancels at period end", expired: "Expired", canceled: "Canceled", suspended: "Suspended", rejected: "Declined", withdrawn: "Withdrawn" },
  noAutoCharge: "You will not be charged automatically when the trial ends. Apply for a paid plan to keep using it.",
  perTenant: "per space / month",
  aggregating: "Aggregating",
  ui: {
    list: {
      titleAll: "All apps", titleTrial: "Apps with free trials", titleRecommended: "Recommended apps",
      filters: "Filters", price: "Price", category: "Category", industry: "Industry", integration: "Integrations",
      freePlan: "Free plan available", trialAvail: "Free trial available", recommended: "Recommended", apply: "Apply filters",
      results: "Results", count: (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? "app" : "apps"}`, removeChip: (l: string) => `Remove filter: ${l}`, clearAll: "Clear all",
      emptyTitle: "No apps match your search", emptyHint: "Try different keywords or remove some filters.", clearFilters: "Clear filters",
      pages: "Pages", prev: "Previous", next: "Next", filterButton: (n: number) => `Filters${n > 0 ? ` (${n})` : ""}`, close: "Close",
      sortLabel: "Sort by", sortRecommended: "Recommended", sortNew: "Newest", sortPrice: "Lowest price", perPageLabel: "Per page", perPage: (n: number) => `${n} per page`,
    },
    price: { contact: "Contact us", free: "Free", freePlanAvailable: " plan available", fromPerMonth: " / month (tax incl.) and up", perMonth: " / month (tax incl.)", trialDays: (d: number) => `${d}-day free trial` },
    badge: { recommended: "Recommended", isNew: "NEW" },
    home: { topic: "Featured", byCategory: "Browse by category", recommended: "Recommended apps", latest: "New apps", ranking: "Most started", seeAll: "See all", seeRanking: "See ranking", firstTime: "New to MarketStars?", seeHelp: "Visit help", last30: (n: number) => `${n} spaces in the last 30 days` },
    ranking: { title: "Most started apps", basis: "How it works: the number of spaces (stores) that started using each app in the last 30 days. Free trials, internal tests, withdrawn and declined applications are excluded, and each space counts once per app. Updated hourly.", lastComputed: (d: string) => `Last updated: ${d}`, overall: "All", categories: "Categories", aggregating: "Still aggregating: there is not enough usage data yet, so only current counts are shown.", empty: "The ranking for this category is still being aggregated." },
    detail: {
      overview: "Overview", plans: "Plans", reviews: "Reviews", cases: "Case studies", support: "Support", inPage: "On this page",
      solves: "What it solves", features: "Key features", prerequisites: "Requirements", dataNeeds: "Data used", setup: "Setup", limitations: "Limitations",
      trialNoAuto: "No automatic charge after the trial", externalContract: "Requires a separate contract with the provider", noCases: "No published case studies yet.", noScreens: "Screenshots coming soon",
      provider: "Provider", email: "Email", hours: "Hours", privacy: "Privacy", privacyPolicy: "Privacy policy", terms: "Terms", version: "Version", updated: "Updated", ask: "Ask about this app",
      price: "Price", applyingSpace: "Space: ", currentState: "Status: ", switchToPaid: "Switch to a paid plan", trialAvail: (d: number) => `${d}-day free trial available`,
      externalNotice: "This is an external service. You may need to sign in to the provider's service separately after opening it.", industries: "Industries", integrations: "Integrations",
      enlarge: (alt: string) => `Enlarge ${alt}`, close: "Close", prev: "Previous", next: "Next", screenshots: "Screenshots", tokenPrice: (n: string) => `+ AI usage: ${n} per 1M tokens (billed monthly)`,
      noReviews: "No reviews yet.", providerReply: "Reply from the provider", canReviewHint: "Reviews can be posted by people who have used this app in this space.",
    },
    myApps: { title: "My apps", space: "Space", owner: "owner", member: "member", switch: "Switch", billing: "Billing", agents: "AI agents", empty: "No apps are in use in this space yet.", findApps: "Find apps", groups: { using: "In use", trial: "Free trial", pending: "Applied", ended: "Ended" }, trialEnds: (d: string) => `Trial ends ${d}`, periodEnds: (d: string) => `Period ends ${d}`, cancelAt: (d: string) => `Cancels ${d}`, pendingNote: "The operator is confirming the contract and payment", open: "Open app", contract: "Contract" },
  },
};

export const messages: Record<Locale, Messages> = { ja, en };

/** 兼容：未切换到按请求语言的旧代码使用日语。 */
export const t = ja;

export async function getLocale(): Promise<Locale> {
  try {
    const v = (await cookies()).get(LOCALE_COOKIE)?.value;
    return v === "en" ? "en" : "ja";
  } catch {
    return "ja";
  }
}

export async function getMessages(): Promise<Messages> {
  return messages[await getLocale()];
}
