// 示范接入应用「AI POPメーカー」。逻辑上视为独立应用：只通过 MarketStars 公开的
// 服务端 API（launch/exchange、entitlements/check）和自身 client secret 与市场交互。
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { config } from "@/lib/config";

export const CLIENT_ID = "pop-writer";
const COOKIE = "popw_session";
const secret = () => config.launchSecret(CLIENT_ID);

export type PopSession = { u: string; n: string; t: string; tn: string; exp: number };

export function basicAuth() {
  return "Basic " + Buffer.from(`${CLIENT_ID}:${secret()}`).toString("base64");
}

function sign(v: string) {
  return crypto.createHmac("sha256", secret()).update(v).digest("base64url");
}

export async function setPopSession(s: PopSession) {
  const v = Buffer.from(JSON.stringify(s)).toString("base64url");
  (await cookies()).set(COOKIE, `${v}.${sign(v)}`, { httpOnly: true, sameSite: "lax", path: "/integrations/pop-writer", secure: config.baseUrl.startsWith("https://"), maxAge: 3600 });
}

export async function getPopSession(): Promise<PopSession | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw || !secret()) return null;
  const [v, sig] = raw.split(".");
  if (!v || !sig || sign(v) !== sig) return null;
  const s = JSON.parse(Buffer.from(v, "base64url").toString()) as PopSession;
  return s.exp > Date.now() ? s : null;
}

/** 每次使用前向 MarketStars 复查权益，不能绕过市场直接获得付费能力。 */
export async function checkEntitlement(tenantId: string) {
  const r = await fetch(`${config.baseUrl}/api/v1/entitlements/check`, { method: "POST", headers: { authorization: basicAuth(), "content-type": "application/json" }, body: JSON.stringify({ tenant_id: tenantId }), cache: "no-store" });
  if (!r.ok) return { entitled: false, plan_key: null as string | null, status: "error" };
  return (await r.json()) as { entitled: boolean; plan_key: string | null; status: string; expires_at: string | null };
}

const TONES: Record<string, string[]> = {
  friendly: ["今日のおすすめ！", "みんなに食べてほしい", "ほっとする"],
  premium: ["こだわり抜いた", "特別なひとときに", "職人が仕上げた"],
  urgent: ["本日限定！", "数量限定・お早めに", "なくなり次第終了"],
};

export function generateCopies(product: string, features: string, tone: string, count: number) {
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
