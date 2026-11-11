/**
 * MarketStars 接入 SDK（服务端用）。接入应用用自己的 client_id / client_secret 调用：
 *  - exchangeLaunch：兑换「アプリを開く」时的一次性启动码，得到用户/空间/权益
 *  - checkEntitlement：每次使用付费能力前复查权益
 *  - messages：通过统一模型网关调用模型，按 Token 计费到租户
 * secret 只能放在服务端，绝不能下发到浏览器。
 */
export type Entitlement = { entitled: boolean; status: string; kind: string | null; plan_key: string | null; expires_at: string | null };
export type LaunchIdentity = { user_id: string; user_name: string; tenant_id: string; tenant_name: string; app: string; entitlement: Entitlement };
export type ModelMessage = { role: "user" | "assistant"; content: string };
export type ModelResponse = { text: string; model: string; stop_reason: string | null; usage: { input_tokens: number; output_tokens: number; unit_price_jpy_per_mtok: number; cost_jpy: number } };

export class MarketStarsError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export class MarketStarsClient {
  constructor(private opts: { baseUrl: string; clientId: string; clientSecret: string; timeoutMs?: number }) {}

  private async post<T>(path: string, body: unknown): Promise<T> {
    const r = await fetch(this.opts.baseUrl.replace(/\/$/, "") + path, {
      method: "POST",
      headers: { authorization: "Basic " + Buffer.from(`${this.opts.clientId}:${this.opts.clientSecret}`).toString("base64"), "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 60000),
    });
    const j = (await r.json().catch(() => ({}))) as { title?: string; detail?: string };
    if (!r.ok) throw new MarketStarsError(r.status, j.title ?? "error", j.detail ?? `HTTP ${r.status}`);
    return j as T;
  }

  exchangeLaunch(code: string) {
    return this.post<LaunchIdentity>("/api/v1/launch/exchange", { code });
  }

  checkEntitlement(tenantId: string) {
    return this.post<Entitlement>("/api/v1/entitlements/check", { tenant_id: tenantId });
  }

  /** requestId 用于幂等：同一请求重试时传入相同值，不会重复计费。 */
  messages(p: { tenantId: string; requestId: string; messages: ModelMessage[]; system?: string; model?: string; maxTokens?: number; effort?: "low" | "medium" | "high" }) {
    return this.post<ModelResponse>("/api/v1/models/messages", { tenant_id: p.tenantId, request_id: p.requestId, messages: p.messages, system: p.system, model: p.model, max_tokens: p.maxTokens, effort: p.effort });
  }
}
