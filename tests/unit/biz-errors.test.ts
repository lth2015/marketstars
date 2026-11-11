import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { EN_BY_CODE, EN_BY_TEXT } from "@/lib/biz-errors";

// 只在运营后台出现的错误（后台只用日语），不要求英文。
const OPERATOR_ONLY = new Set(["receipt", "receipt_used", "reason", "note", "ticket", "amount"]);

function literalErrors(): { code: string; message: string; file: string }[] {
  const dir = join(__dirname, "../../src/lib");
  const files = readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith(".ts"));
  const out: { code: string; message: string; file: string }[] = [];
  for (const f of files) {
    const src = readFileSync(join(dir, f), "utf8");
    for (const m of src.matchAll(/new BizError\("([a-z_]+)",\s*"([^"]+)"\)/g)) out.push({ code: m[1], message: m[2], file: f });
    for (const m of src.matchAll(/code: "([a-z_]+)", message: "([^"]+)"/g)) out.push({ code: m[1], message: m[2], file: f });
  }
  return out;
}

describe("BizError English messages", () => {
  it("finds the error literals", () => {
    expect(literalErrors().length).toBeGreaterThan(40);
  });
  it("every customer-facing error literal has an English translation", () => {
    const missing = literalErrors().filter((e) => !OPERATOR_ONLY.has(e.code) && !EN_BY_TEXT[e.message]);
    expect(missing).toEqual([]);
  });
  it("dynamic customer-facing errors fall back to a per-code message", () => {
    for (const code of ["in_use", "blocked", "state", "not_found"]) expect(EN_BY_CODE[code]).toBeTruthy();
  });
});
