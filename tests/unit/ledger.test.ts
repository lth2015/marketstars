import { describe, expect, it } from "vitest";
import { canonical, entryHash, GENESIS } from "@/lib/ledger";

const e = { kind: "payment", refId: "b1", amountJpy: 1980, tenantId: "t1", providerId: "p1", occurredAt: new Date("2026-11-11T00:00:00Z"), payload: { b: 2, a: 1 } };

describe("台帐哈希链", () => {
  it("规范化 JSON 与键顺序无关", () => expect(canonical({ b: 2, a: [1, { d: 1, c: 2 }] })).toBe(canonical({ a: [1, { c: 2, d: 1 }], b: 2 })));
  it("同样内容同样哈希；金额变化哈希变化", () => {
    const h = entryHash(GENESIS, e);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(entryHash(GENESIS, { ...e, payload: { a: 1, b: 2 } })).toBe(h);
    expect(entryHash(GENESIS, { ...e, amountJpy: 1981 })).not.toBe(h);
  });
  it("依赖前一条哈希", () => expect(entryHash("f".repeat(64), e)).not.toBe(entryHash(GENESIS, e)));
});
