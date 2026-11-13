import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { buildFromZip, checkPath, sampleZip } from "@/lib/hosting";

const zip = (files: Record<string, string | Uint8Array>) => zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === "string" ? strToU8(v) : v])));
const last = (r: ReturnType<typeof buildFromZip>) => r.log[r.log.length - 1].msg;

describe("hosting build", () => {
  it("builds the sample and strips the common top-level folder", () => {
    const r = buildFromZip(sampleZip("1.2.3"));
    expect(r.ok).toBe(true);
    expect(r.files.map((f) => f.path).sort()).toEqual(["about.html", "app.js", "index.html", "style.css"]);
    expect(r.files.find((f) => f.path === "index.html")!.data.toString()).toContain("v1.2.3");
  });

  it("ignores hidden files and __MACOSX", () => {
    const r = buildFromZip(zip({ "index.html": "<p>x</p>", ".env": "SECRET=1", "__MACOSX/._index.html": "x", "img/.DS_Store": "x" }));
    expect(r.ok).toBe(true);
    expect(r.files.map((f) => f.path)).toEqual(["index.html"]);
  });

  it("requires index.html at the root", () => {
    const r = buildFromZip(zip({ "app/main.html": "x", "other/x.css": "" }));
    expect(r.ok).toBe(false);
    expect(last(r)).toContain("index.html");
  });

  it("rejects server-side code and unknown file types", () => {
    const r = buildFromZip(zip({ "index.html": "x", "api.php": "<?php system($_GET['c']);" }));
    expect(r.ok).toBe(false);
    expect(last(r)).toContain("api.php");
  });

  it("rejects path traversal and backslashes", () => {
    expect(checkPath("../etc/passwd")).not.toBeNull();
    expect(checkPath("a/../../b.html")).not.toBeNull();
    expect(checkPath("/abs.html")).not.toBeNull();
    expect(checkPath("a\\b.html")).not.toBeNull();
    expect(checkPath("a//b.html")).not.toBeNull();
    expect(checkPath("css/site.css")).toBeNull();
    const r = buildFromZip(zip({ "index.html": "x", "../escape.html": "x" }));
    expect(r.ok).toBe(false);
  });

  it("stops oversized archives before inflating them (zip bomb)", () => {
    const big = new Uint8Array(3 * 1024 * 1024); // 3MB of zeros compresses to a few KB
    const r = buildFromZip(zip({ "index.html": "x", "big.js": big }));
    expect(r.ok).toBe(false);
    expect(last(r)).toContain("上限");
  });

  it("rejects input that is not a zip", () => {
    expect(buildFromZip(strToU8("not a zip")).ok).toBe(false);
  });

  it("warns (but builds) when HTML loads scripts from other sites", () => {
    const r = buildFromZip(zip({ "index.html": '<script src="https://cdn.example.com/x.js"></script>' }));
    expect(r.ok).toBe(true);
    expect(r.log.some((l) => l.msg.includes("外部サイトのスクリプト"))).toBe(true);
  });
});

describe("hosting zip reader", () => {
  it("caps the real inflated size even when the header understates it", () => {
    const z = zip({ "index.html": "x", "big.js": new Uint8Array(3 * 1024 * 1024) });
    // big.js の中央ディレクトリと local header の「展開後サイズ」を 10 バイトに偽装
    const b = Buffer.from(z);
    for (let i = 0; i < b.length - 4; i++) {
      if (b.readUInt32LE(i) === 0x02014b50 && b.subarray(i + 46, i + 52).toString() === "big.js") b.writeUInt32LE(10, i + 24);
      if (b.readUInt32LE(i) === 0x04034b50 && b.subarray(i + 30, i + 36).toString() === "big.js") b.writeUInt32LE(10, i + 22);
    }
    const r = buildFromZip(b);
    expect(r.ok).toBe(false);
    expect(last(r)).toContain("上限");
  });
});
