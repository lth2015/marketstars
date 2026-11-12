// デモ用の「接入アプリ」の共通部分。各アプリは論理的に独立したアプリとして、MarketStars の公開 API
// （launch/exchange・entitlements/check・models/messages）と自分の client secret だけで市場とやり取りする。
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { config } from "@/lib/config";
import { MarketStarsClient } from "@/sdk/marketstars";

export type AppSession = { u: string; n: string; t: string; tn: string; exp: number };

export function integrationApp(clientId: string) {
  const cookie = `${clientId.replace(/[^a-z0-9]/g, "")}_session`;
  const path = `/integrations/${clientId}`;
  const secret = () => config.launchSecret(clientId);
  const sign = (v: string) => crypto.createHmac("sha256", secret()).update(v).digest("base64url");
  const marketstars = () => new MarketStarsClient({ baseUrl: config.baseUrl, clientId, clientSecret: secret() });

  return {
    clientId,
    path,
    marketstars,
    async setSession(s: AppSession) {
      const v = Buffer.from(JSON.stringify(s)).toString("base64url");
      (await cookies()).set(cookie, `${v}.${sign(v)}`, { httpOnly: true, sameSite: "lax", path, secure: config.baseUrl.startsWith("https://"), maxAge: 3600 });
    },
    async getSession(): Promise<AppSession | null> {
      const raw = (await cookies()).get(cookie)?.value;
      if (!raw || !secret()) return null;
      const [v, sig] = raw.split(".");
      if (!v || !sig) return null;
      const expected = sign(v);
      if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
      const s = JSON.parse(Buffer.from(v, "base64url").toString()) as AppSession;
      return s.exp > Date.now() ? s : null;
    },
    /** 毎回の利用前に MarketStars で権利を確認する（市場を迂回して有料機能を使えない）。 */
    async checkEntitlement(tenantId: string) {
      try {
        return await marketstars().checkEntitlement(tenantId);
      } catch {
        return { entitled: false, plan_key: null as string | null, status: "error", kind: null, expires_at: null };
      }
    },
    /** 「アプリを開く」から渡されたワンタイム起動コードを交換してセッションを作る。 */
    async start(code: string | null): Promise<"ok" | "launch" | "denied"> {
      if (!code) return "launch";
      try {
        const j = await marketstars().exchangeLaunch(code);
        await this.setSession({ u: j.user_id, n: j.user_name, t: j.tenant_id, tn: j.tenant_name, exp: Date.now() + 3600000 });
        return "ok";
      } catch {
        return "denied";
      }
    },
  };
}
