import { describe, expect, it } from "vitest";
import { mockpay } from "@/lib/payments/provider";

const card = (number: string) => ({ number, expMonth: 12, expYear: 2030, cvc: "123" });

describe("mockpay", () => {
  it("成功卡：令牌化后扣款成功，同一幂等键返回同一 chargeId", async () => {
    const t = await mockpay.tokenize(card("4242 4242 4242 4242"));
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.last4).toBe("4242");
    const a = await mockpay.charge(t.token, 1980, "k1");
    const b = await mockpay.charge(t.token, 1980, "k1");
    expect(a.ok && b.ok && a.chargeId === b.chargeId).toBe(true);
  });
  it("拒绝卡在登记时失败", async () => expect((await mockpay.tokenize(card("4000000000000002"))).ok).toBe(false));
  it("0341 可登记但扣款失败（续费失败演示）", async () => {
    const t = await mockpay.tokenize(card("4000000000000341"));
    expect(t.ok).toBe(true);
    if (t.ok) expect((await mockpay.charge(t.token, 1980, "k2")).ok).toBe(false);
  });
  it("Luhn / 过期 / CVC 校验", async () => {
    expect((await mockpay.tokenize(card("4242424242424241"))).ok).toBe(false);
    expect((await mockpay.tokenize({ ...card("4242424242424242"), expYear: 2020 })).ok).toBe(false);
    expect((await mockpay.tokenize({ ...card("4242424242424242"), cvc: "1" })).ok).toBe(false);
  });
  it("伪造令牌不能扣款", async () => expect((await mockpay.charge("pm_mock_ok_abc_AAAAAAAAAAAAAAAA", 100, "k3")).ok).toBe(false));
});
