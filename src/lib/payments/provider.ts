// 支付服务商抽象。demo 使用 mockpay（无外部依赖、确定性结果）；正式环境替换为
// 实际的决济代行（例如 Stripe / GMO-PG / StarPay），卡号只在服务商页面输入，MarketStars 只接收令牌。
import crypto from "node:crypto";

export type CardInput = { number: string; expMonth: number; expYear: number; cvc: string };
export type Tokenized = { ok: true; token: string; brand: string; last4: string; expMonth: number; expYear: number } | { ok: false; code: string; message: string };
export type ChargeResult = { ok: true; chargeId: string } | { ok: false; code: string; message: string };

export interface PaymentProvider {
  name: string;
  tokenize(card: CardInput): Promise<Tokenized>;
  charge(token: string, amountJpy: number, idempotencyKey: string): Promise<ChargeResult>;
}

/** mockpay 测试卡：4242… 成功；4000 0000 0000 0002 拒绝；4000 0000 0000 0341 可登记但扣款失败（续费失败演示）。 */
export const TEST_CARDS = [
  { number: "4242 4242 4242 4242", label: "成功" },
  { number: "4000 0000 0000 0002", label: "カード拒否" },
  { number: "4000 0000 0000 0341", label: "登録可・請求失敗（自動更新失敗の確認用）" },
];

function luhn(n: string) {
  let sum = 0;
  for (let i = 0; i < n.length; i++) {
    let d = Number(n[n.length - 1 - i]);
    if (i % 2) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

const SECRET = () => process.env.SESSION_SECRET ?? "mockpay";

export const mockpay: PaymentProvider = {
  name: "mockpay",
  async tokenize(card) {
    const n = card.number.replace(/\D/g, "");
    if (n.length < 14 || n.length > 19 || !luhn(n)) return { ok: false, code: "invalid_number", message: "カード番号が正しくありません。" };
    const now = new Date();
    const y = card.expYear < 100 ? 2000 + card.expYear : card.expYear;
    if (!(card.expMonth >= 1 && card.expMonth <= 12) || y < now.getFullYear() || (y === now.getFullYear() && card.expMonth < now.getMonth() + 1)) return { ok: false, code: "expired", message: "有効期限が正しくありません。" };
    if (!/^\d{3,4}$/.test(card.cvc)) return { ok: false, code: "invalid_cvc", message: "セキュリティコードが正しくありません。" };
    if (n === "4000000000000002") return { ok: false, code: "card_declined", message: "このカードはご利用いただけません。" };
    const mode = n === "4000000000000341" ? "fail" : "ok";
    const id = crypto.randomBytes(9).toString("base64url");
    const sig = crypto.createHmac("sha256", SECRET()).update(`${id}.${mode}`).digest("base64url").slice(0, 16);
    return { ok: true, token: `pm_mock_${mode}_${id}_${sig}`, brand: n.startsWith("4") ? "Visa" : n.startsWith("5") ? "Mastercard" : n.startsWith("3") ? "JCB/AMEX" : "Card", last4: n.slice(-4), expMonth: card.expMonth, expYear: y };
  },
  async charge(token, amountJpy, idempotencyKey) {
    const m = /^pm_mock_(ok|fail)_([A-Za-z0-9_-]+)_([A-Za-z0-9_-]{16})$/.exec(token);
    if (!m) return { ok: false, code: "invalid_token", message: "支払い方法が無効です。" };
    const sig = crypto.createHmac("sha256", SECRET()).update(`${m[2]}.${m[1]}`).digest("base64url").slice(0, 16);
    if (sig !== m[3]) return { ok: false, code: "invalid_token", message: "支払い方法が無効です。" };
    if (amountJpy <= 0) return { ok: false, code: "invalid_amount", message: "金額が不正です。" };
    if (m[1] === "fail") return { ok: false, code: "insufficient_funds", message: "カード会社により決済が承認されませんでした。" };
    // 同一 idempotencyKey 返回同一 chargeId（服务商侧幂等）
    return { ok: true, chargeId: "ch_mock_" + crypto.createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 24) };
  },
};

export function paymentProvider(): PaymentProvider {
  return mockpay;
}
