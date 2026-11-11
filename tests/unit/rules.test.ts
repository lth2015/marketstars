import { describe, expect, it } from "vitest";
import { addOneMonthJst } from "@/lib/time";
import { isSafeLaunchUrl, normalizeSearch, safeReturnTo } from "@/lib/text";
import { derivePricing, parseListQuery, queryToSearchParams } from "@/lib/catalog";
import { isEntitled } from "@/lib/subscriptions";

const jst = (s: string) => new Date(`${s}+09:00`);

describe("周期（JST，下月同日同刻；无对应日取月末）", () => {
  it("普通日期", () => expect(addOneMonthJst(jst("2026-11-11T10:30:00")).toISOString()).toBe(jst("2026-12-11T10:30:00").toISOString()));
  it("1/31 → 2/28", () => expect(addOneMonthJst(jst("2027-01-31T09:00:00")).toISOString()).toBe(jst("2027-02-28T09:00:00").toISOString()));
  it("闰年 1/31 → 2/29", () => expect(addOneMonthJst(jst("2028-01-31T09:00:00")).toISOString()).toBe(jst("2028-02-29T09:00:00").toISOString()));
  it("跨年 12/15 → 1/15", () => expect(addOneMonthJst(jst("2026-12-15T23:59:00")).toISOString()).toBe(jst("2027-01-15T23:59:00").toISOString()));
  it("JST 月末但 UTC 仍为前一天", () => expect(addOneMonthJst(jst("2027-03-31T05:00:00")).toISOString()).toBe(jst("2027-04-30T05:00:00").toISOString()));
});

describe("搜索归一化", () => {
  it("全半角、大小写、前后空格", () => expect(normalizeSearch("  ＰＯＰ　Maker ")).toBe("pop maker"));
  it("平假名→片假名", () => expect(normalizeSearch("しふと")).toBe("シフト"));
});

describe("安全", () => {
  it("回跳只允许站内相对路径", () => {
    expect(safeReturnTo("/apps/x")).toBe("/apps/x");
    expect(safeReturnTo("//evil.com")).toBe("/");
    expect(safeReturnTo("https://evil.com")).toBe("/");
    expect(safeReturnTo("/\\evil.com")).toBe("/");
  });
  it("启动地址只允许 https", () => {
    expect(isSafeLaunchUrl("https://app.example.com")).toBe(true);
    expect(isSafeLaunchUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeLaunchUrl("http://evil.example.com")).toBe(false);
  });
});

describe("目录查询", () => {
  it("非法参数回退默认", () => {
    const q = parseListQuery({ sort: "hack", per: "999", page: "-3" });
    expect([q.sort, q.perPage, q.page]).toEqual(["recommended", 30, 1]);
  });
  it("URL 往返", () => {
    const q = parseListQuery({ q: "POP", category: ["a", "b"], free: "true", sort: "price", per: "10", page: "2" });
    expect(queryToSearchParams(q)).toBe("?q=POP&category=a&category=b&free=true&sort=price&per=10&page=2");
  });
  it("最低价：免费=0，要咨询不计", () => {
    expect(derivePricing([{ priceType: "contact", priceJpy: 0, trialDays: 0 }]).minMonthlyPrice).toBeNull();
    expect(derivePricing([{ priceType: "monthly", priceJpy: 1980, trialDays: 14 }, { priceType: "contact", priceJpy: 0, trialDays: 0 }])).toMatchObject({ minMonthlyPrice: 1980, hasTrial: true, maxTrialDays: 14 });
  });
});

describe("权益判断", () => {
  const now = new Date("2026-11-11T00:00:00Z");
  const past = new Date("2026-11-10T00:00:00Z"), future = new Date("2026-11-12T00:00:00Z");
  const base = { kind: "paid", trialEndsAt: null, currentPeriodEnd: null, cancelAt: null } as const;
  it("pending 无权益", () => expect(isEntitled({ ...base, status: "pending" }, now)).toBe(false));
  it("试用到期无权益", () => expect(isEntitled({ ...base, kind: "trial", status: "trialing", trialEndsAt: past }, now)).toBe(false));
  it("付费期内有效、结束不包含", () => {
    expect(isEntitled({ ...base, status: "active", currentPeriodEnd: future }, now)).toBe(true);
    expect(isEntitled({ ...base, status: "active", currentPeriodEnd: now }, now)).toBe(false);
  });
  it("期末退订期内可用", () => expect(isEntitled({ ...base, status: "cancel_scheduled", cancelAt: future }, now)).toBe(true));
  it("暂停无权益", () => expect(isEntitled({ ...base, status: "suspended", currentPeriodEnd: future }, now)).toBe(false));
});

import { costMilli, jstMonth, prevMonth } from "@/lib/usage";

describe("按量计费与月份（JST）", () => {
  it("千分之一日元向上取整", () => {
    expect(costMilli(1000, 3000)).toBe(3000); // 1000 tokens × ¥3000/MTok = ¥3
    expect(costMilli(1, 3000)).toBe(3);
    expect(costMilli(1, 1)).toBe(1);
  });
  it("JST 月界：UTC 10/31 15:00 属于 11 月", () => {
    expect(jstMonth(undefined, new Date("2026-10-31T15:00:00Z")).key).toBe("2026-11");
    expect(jstMonth(undefined, new Date("2026-10-31T14:59:59Z")).key).toBe("2026-10");
    expect(jstMonth("2026-11").start.toISOString()).toBe("2026-10-31T15:00:00.000Z");
  });
  it("上个月（跨年）", () => expect(prevMonth(new Date("2027-01-05T00:00:00Z")).key).toBe("2026-12"));
});
