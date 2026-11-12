import { describe, expect, it } from "vitest";
import { DEMO_SCENARIOS } from "@/lib/demo-scenarios";
import { DEMO_PERSONAS } from "@/lib/demo-identities";
import { safeReturnTo } from "@/lib/text";

describe("デモガイドの手順", () => {
  const steps = DEMO_SCENARIOS.flatMap((s) => s.steps.map((st) => ({ scenario: s.id, ...st })));
  it("利用者と空間の組み合わせはデモ身份に存在する", () => {
    for (const st of steps.filter((x) => x.as)) {
      const p = DEMO_PERSONAS.find((x) => x.userId === st.as!.userId);
      expect(p, `${st.scenario}: ${st.title}`).toBeTruthy();
      expect(p!.tenants.some((t) => t.id === st.as!.tenantId), `${st.scenario}: ${st.title}`).toBe(true);
    }
  });
  it("遷移先はサイト内の相対パス（returnTo の検証を通る）", () => {
    for (const st of steps) expect(safeReturnTo(st.path), st.title).toBe(st.path);
  });
  it("シナリオ ID は一意", () => {
    expect(new Set(DEMO_SCENARIOS.map((s) => s.id)).size).toBe(DEMO_SCENARIOS.length);
  });
});
