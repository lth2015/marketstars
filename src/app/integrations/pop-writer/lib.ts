// 示范接入应用「AI POPメーカー」。逻辑上视为独立应用：只通过 MarketStars 公开的
// 服务端 API（launch/exchange、entitlements/check）和自身 client secret 与市场交互。
import { integrationApp, type AppSession } from "@/lib/integration-demo";

export const CLIENT_ID = "pop-writer";
const app = integrationApp(CLIENT_ID);

export type PopSession = AppSession;
export const marketstars = app.marketstars;
export const setPopSession = (s: PopSession) => app.setSession(s);
export const getPopSession = () => app.getSession();
/** 每次使用前向 MarketStars 复查权益，不能绕过市场直接获得付费能力。 */
export const checkEntitlement = (tenantId: string) => app.checkEntitlement(tenantId);
export const startPop = (code: string | null) => app.start(code);

const TONES: Record<string, string[]> = {
  friendly: ["今日のおすすめ！", "みんなに食べてほしい", "ほっとする"],
  premium: ["こだわり抜いた", "特別なひとときに", "職人が仕上げた"],
  urgent: ["本日限定！", "数量限定・お早めに", "なくなり次第終了"],
};

const TONES_EN: Record<string, string[]> = {
  friendly: ["Today's pick!", "You'll love", "Feel-good"],
  premium: ["Carefully crafted", "For a special moment", "Made by our artisans"],
  urgent: ["Today only!", "Limited stock", "While supplies last"],
};

function generateCopiesEn(product: string, features: string, tone: string, count: number) {
  const f = features.split(/[、,\n]/).map((x) => x.trim()).filter(Boolean);
  const words = TONES_EN[tone] ?? TONES_EN.friendly;
  const pick = (i: number) => f[i % Math.max(1, f.length)] ?? "";
  const templates = [
    (i: number) => `${words[i % 3]} ${product}\nProudly ${pick(i) || "made fresh"}.`,
    (i: number) => `[${product}]\n${pick(i)}${pick(i + 1) ? ` & ${pick(i + 1)}` : ""}. ${words[(i + 1) % 3]} treat.`,
    (i: number) => `${pick(i) || "Everyday"} goodness: ${product}.\n${words[(i + 2) % 3]} flavor, delivered.`,
    (i: number) => `#${product.replace(/\s/g, "")} ${f.map((x) => `#${x.replace(/\s/g, "")}`).join(" ")}\n${words[i % 3]} Give it a try.`,
    (i: number) => `Staff pick: ${product}\nThe secret is "${pick(i + 2) || pick(i)}". ${words[(i + 1) % 3]}`,
  ];
  return Array.from({ length: count }, (_, i) => templates[i % templates.length](i));
}

export function generateCopies(product: string, features: string, tone: string, count: number, locale: "ja" | "en" = "ja") {
  if (locale === "en") return generateCopiesEn(product, features, tone, count);
  const f = features.split(/[、,\n]/).map((x) => x.trim()).filter(Boolean);
  const words = TONES[tone] ?? TONES.friendly;
  const out: string[] = [];
  const pick = (i: number) => f[i % Math.max(1, f.length)] ?? "";
  const templates = [
    (i: number) => `${words[i % 3]} ${product}\n${pick(i)}が自慢です。`,
    (i: number) => `【${product}】\n${pick(i)}${pick(i + 1) ? `×${pick(i + 1)}` : ""}。${words[(i + 1) % 3]}一品をどうぞ。`,
    (i: number) => `${pick(i) || "毎日"}にうれしい、${product}。\n${words[(i + 2) % 3]}おいしさをお届けします。`,
    (i: number) => `#${product.replace(/\s/g, "")} ${f.map((x) => `#${x.replace(/\s/g, "")}`).join(" ")}\n${words[i % 3]} ぜひお試しください。`,
    (i: number) => `スタッフおすすめ：${product}\n「${pick(i + 2) || pick(i)}」がポイント。${words[(i + 1) % 3]}`,
  ];
  for (let i = 0; i < count; i++) out.push(templates[i % templates.length](i));
  return out;
}
