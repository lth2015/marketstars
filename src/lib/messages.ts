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
