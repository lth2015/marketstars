// MarketStars ホスティング（PRD「後続：任意コードのアップロードと自動デプロイ」のデモ版）。
// 対象は静的サイト（HTML/CSS/JS/画像）のみ。サーバー側でコードは実行しない。
// 配信は /hosted/{slug}/… から、CSP sandbox（allow-same-origin なし）付きで行うため、
// アップロードされたスクリプトは不透明オリジンで動き、MarketStars の Cookie・API に触れない。
// 本番運用では別ドメイン（例：*.apps.marketstars.example）からの配信を推奨。
import crypto from "node:crypto";
import zlib from "node:zlib";
import { zipSync, strToU8 } from "fflate";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { audit } from "./audit";
import { invalidateCatalog } from "./cache";

export const LIMITS = { zipBytes: 5 * 1024 * 1024, files: 200, fileBytes: 2 * 1024 * 1024, totalBytes: 20 * 1024 * 1024 };

export const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8",
  json: "application/json", webmanifest: "application/manifest+json", map: "application/json", txt: "text/plain; charset=utf-8",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml", ico: "image/x-icon",
  woff: "font/woff", woff2: "font/woff2",
};

export type LogLine = { ok: boolean; msg: string };
export type BuildResult = { ok: boolean; log: LogLine[]; files: { path: string; contentType: string; data: Buffer }[] };

const extOf = (p: string) => (p.split("/").pop() ?? "").split(".").slice(1).pop()?.toLowerCase() ?? "";
const isHtml = (p: string) => ["html", "htm"].includes(extOf(p));

/** パスの検査：相対・正規化済み・制御文字なし。問題があれば理由を返す。 */
export function checkPath(p: string): string | null {
  if (!p || p.length > 250) return "パスが長すぎます";
  if (/[\u0000-\u001f\u007f\\]/.test(p)) return "使用できない文字が含まれています";
  if (p.startsWith("/") || /^[a-z]:/i.test(p)) return "絶対パスは使えません";
  if (p.split("/").some((s) => s === ".." || s === "." || s === "")) return "「..」などを含むパスは使えません";
  return null;
}

class ZipLimit extends Error {}

/**
 * 最小限の zip リーダー（中央ディレクトリを読む）。展開は zlib の maxOutputLength で実サイズを制限するため、
 * ヘッダーのサイズを偽った zip（zip 爆弾）でもメモリを使い切らない。暗号化・ZIP64・未対応の圧縮方式は不可。
 */
function readZip(buf: Buffer): Record<string, Uint8Array> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("no eocd");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (count > LIMITS.files * 2) throw new ZipLimit();
  const out: Record<string, Uint8Array> = {};
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("bad cd");
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString(flags & 0x800 ? "utf8" : "latin1");
    p += 46 + nlen + elen + clen;
    if (name.endsWith("/")) continue;
    if (flags & 1) throw new Error("encrypted");
    if (csize === 0xffffffff || usize === 0xffffffff || off === 0xffffffff) throw new Error("zip64");
    if (usize > LIMITS.fileBytes) throw new ZipLimit();
    if (buf.readUInt32LE(off) !== 0x04034b50) throw new Error("bad local header");
    const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const raw = buf.subarray(start, start + csize);
    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) {
      try { data = zlib.inflateRawSync(raw, { maxOutputLength: LIMITS.fileBytes }); }
      catch (e) { if ((e as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") throw new ZipLimit(); throw e; }
    } else throw new Error("unsupported method");
    total += data.length;
    if (total > LIMITS.totalBytes) throw new ZipLimit();
    out[name] = data;
  }
  return out;
}

/**
 * zip を展開して検証する（＝ビルド）。サーバー側でコードは実行しない。
 * - 共通の最上位フォルダ（dist/ など）は取り除く
 * - __MACOSX・.DS_Store・隠しファイルは無視
 * - 許可した拡張子のみ、件数・サイズの上限、ルートに index.html が必須
 */
export function buildFromZip(zip: Uint8Array): BuildResult {
  const log: LogLine[] = [];
  const fail = (msg: string): BuildResult => { log.push({ ok: false, msg }); return { ok: false, log, files: [] }; };
  if (zip.length > LIMITS.zipBytes) return fail(`zip が大きすぎます（上限 ${LIMITS.zipBytes / 1024 / 1024}MB）`);
  let entries: Record<string, Uint8Array>;
  try {
    entries = readZip(Buffer.from(zip));
  } catch (e) {
    return fail(e instanceof ZipLimit ? `ファイル数・サイズの上限を超えています（${LIMITS.files} ファイル、1ファイル ${LIMITS.fileBytes / 1024 / 1024}MB、合計 ${LIMITS.totalBytes / 1024 / 1024}MB）` : "zip ファイルとして読み込めませんでした");
  }
  log.push({ ok: true, msg: `zip を展開しました（${Object.keys(entries).length} 件）` });

  let names = Object.keys(entries).filter((n) => {
    const parts = n.split("/");
    return !parts.some((s) => s === "__MACOSX" || (s.startsWith(".") && s !== "." && s !== ".."));
  });
  const skipped = Object.keys(entries).length - names.length;
  if (skipped) log.push({ ok: true, msg: `隠しファイル・__MACOSX を ${skipped} 件除外しました` });
  // 共通の最上位フォルダを取り除く（例：dist/index.html → index.html）
  const tops = new Set(names.map((n) => (n.includes("/") ? n.split("/")[0] : "")));
  let prefix = "";
  if (tops.size === 1 && !tops.has("")) { prefix = [...tops][0] + "/"; log.push({ ok: true, msg: `最上位フォルダ「${prefix}」を取り除きました` }); }
  names = names.filter((n) => n.startsWith(prefix));

  const files: BuildResult["files"] = [];
  let total = 0;
  for (const n of names.sort()) {
    const path = n.slice(prefix.length);
    const bad = checkPath(path);
    if (bad) return fail(`${n}：${bad}`);
    const type = TYPES[extOf(path)];
    if (!type) return fail(`${path}：この種類のファイルは公開できません（静的ファイル：HTML・CSS・JS・画像・フォントのみ）`);
    const data = Buffer.from(entries[n]);
    if (data.length > LIMITS.fileBytes) return fail(`${path}：1ファイル ${LIMITS.fileBytes / 1024 / 1024}MB を超えています`);
    total += data.length;
    files.push({ path, contentType: type, data });
  }
  if (files.length > LIMITS.files) return fail(`ファイル数が上限（${LIMITS.files}）を超えています`);
  if (total > LIMITS.totalBytes) return fail(`合計サイズが上限を超えています`);
  log.push({ ok: true, msg: `パス・ファイル種類・サイズを確認しました（${files.length} ファイル、${(total / 1024).toFixed(1)}KB）` });
  if (!files.some((f) => f.path === "index.html")) return fail("ルートに index.html がありません");
  log.push({ ok: true, msg: "index.html を確認しました" });
  // 外部スクリプトは配信時の CSP で読み込めないため、警告として知らせる（失敗にはしない）
  const ext = files.filter((f) => isHtml(f.path) && /<script[^>]+src=["']?(https?:)?\/\//i.test(f.data.toString("utf8"))).map((f) => f.path);
  if (ext.length) log.push({ ok: true, msg: `注意：外部サイトのスクリプトは読み込めません（${ext.join("、")}）。必要なファイルは zip に含めてください` });
  log.push({ ok: true, msg: "ビルドに成功しました" });
  return { ok: true, log, files };
}

/** アップロード → ビルド → （任意で）本番反映。ビルド番号はアプリごとの連番。 */
export async function createBuild(appId: string, zip: Uint8Array, actorId: string, opts: { autoDeploy?: boolean; actorType?: "operator" | "user" | "system" } = {}) {
  const sha = crypto.createHash("sha256").update(zip).digest("hex");
  const result = buildFromZip(zip);
  const build = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM App WHERE id = ${appId} FOR UPDATE`;
    const last = await tx.hostedBuild.findFirst({ where: { appId }, orderBy: { number: "desc" }, select: { number: true } });
    const b = await tx.hostedBuild.create({
      data: {
        appId, number: (last?.number ?? 0) + 1, status: result.ok ? "ready" : "failed", sha256: sha, uploadedBy: actorId, finishedAt: new Date(),
        fileCount: result.files.length, totalBytes: result.files.reduce((a, f) => a + f.data.length, 0), log: result.log as unknown as Prisma.InputJsonValue,
      },
    });
    for (const f of result.files) {
      await tx.hostedFile.create({ data: { buildId: b.id, path: f.path, contentType: f.contentType, size: f.data.length, sha256: crypto.createHash("sha256").update(f.data).digest("hex"), data: f.data } });
    }
    await audit(tx, { actorId, actorType: opts.actorType ?? "user", objectType: "hosted_build", objectId: b.id, action: "build", toState: b.status, data: { appId, number: b.number, files: b.fileCount } });
    return b;
  }, { timeout: 30000 });
  if (build.status === "ready" && opts.autoDeploy) await deployBuild(appId, build.id, actorId, "auto_deploy", opts.actorType);
  return build;
}

/** 本番に反映（ロールバックも同じ操作）。成功したビルドのみ。 */
export async function deployBuild(appId: string, buildId: string, actorId: string, action = "deploy", actorType: "operator" | "user" | "system" = "user") {
  const b = await prisma.hostedBuild.findFirst({ where: { id: buildId, appId, status: "ready" } });
  if (!b) return false;
  const app = await prisma.app.update({ where: { id: appId }, data: { hostedBuildId: b.id }, select: { hostedBuildId: true } });
  await audit(prisma, { actorId, actorType, objectType: "app", objectId: appId, action, toState: `build#${b.number}`, data: { buildId: b.id, live: app.hostedBuildId } });
  invalidateCatalog();
  return true;
}

export const hostedEntry = (slug: string, buildId?: string) => `/hosted/${slug}/${buildId ? `~${buildId}/` : ""}index.html`;

/** デモ・サンプル用の静的サイト：レジ締めチェック（現金の金種を入れると合計と差額を計算）。 */
export function sampleSiteFiles(version = "1.0.0"): Record<string, string> {
  const denoms = [10000, 5000, 1000, 500, 100, 50, 10, 5, 1];
  return {
    "index.html": `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>レジ締めチェック</title><link rel="stylesheet" href="style.css"></head>
<body><main>
<header><h1>レジ締めチェック</h1><span class="ver">v${version}</span></header>
<p class="lead">金種ごとの枚数を入れると、現金の合計とレジ記録との差額を計算します。</p>
<form id="f" autocomplete="off">
<table><tbody>
${denoms.map((d) => `<tr><th><label for="d${d}">${d.toLocaleString("ja-JP")}円</label></th><td><input id="d${d}" data-yen="${d}" type="number" min="0" step="1" inputmode="numeric" value="0"></td></tr>`).join("\n")}
</tbody></table>
<label class="exp" for="expected">レジの記録（円）</label><input id="expected" type="number" min="0" step="1" value="0">
</form>
<section class="result" aria-live="polite"><div>現金合計 <strong id="total">0円</strong></div><div>差額 <strong id="diff">0円</strong></div></section>
<p class="note">MarketStars でホスティングされた静的アプリのサンプルです（入力内容はこの画面の中だけで計算され、保存・送信されません）。<a href="about.html">このアプリについて</a></p>
</main><script src="app.js"></script></body></html>
`,
    "about.html": `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>このアプリについて</title><link rel="stylesheet" href="style.css"></head>
<body><main><h1>このアプリについて</h1><p>バージョン ${version}。zip でアップロードされた静的ファイルを、MarketStars がそのまま配信しています。</p><p><a href="index.html">戻る</a></p></main></body></html>
`,
    "style.css": `body{margin:0;font-family:system-ui,-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif;background:#F4F7FB;color:#1B2B3A}
main{max-width:560px;margin:0 auto;padding:24px 16px}
header{display:flex;align-items:baseline;gap:12px}h1{font-size:24px;margin:0;color:#7A3E00}.ver{font-size:12px;color:#5B6B7B}
.lead{color:#3D4D5D}table{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden}
th,td{padding:8px 12px;border-bottom:1px solid #E3E8EF;text-align:left}td input,#expected{width:100%;box-sizing:border-box;height:36px;font-size:16px;border:1px solid #C9D3DE;border-radius:8px;padding:0 8px}
.exp{display:block;margin:16px 0 4px;font-weight:600}.result{margin-top:16px;padding:16px;background:#FFF4E5;border-radius:12px;display:flex;gap:24px;flex-wrap:wrap}
.result strong{font-size:22px;color:#7A3E00}.note{font-size:12px;color:#5B6B7B;margin-top:16px}a{color:#185ABD}
`,
    "app.js": `(function () {
  var f = document.getElementById("f");
  var yen = function (n) { return n.toLocaleString("ja-JP") + "円"; };
  function calc() {
    var total = 0;
    f.querySelectorAll("input[data-yen]").forEach(function (i) { total += Number(i.dataset.yen) * Math.max(0, Math.floor(Number(i.value) || 0)); });
    var diff = total - (Number(document.getElementById("expected").value) || 0);
    document.getElementById("total").textContent = yen(total);
    document.getElementById("diff").textContent = (diff > 0 ? "+" : "") + yen(diff);
  }
  f.addEventListener("input", calc);
  document.getElementById("expected").addEventListener("input", calc);
  calc();
})();
`,
  };
}

export function sampleZip(version?: string, prefix = "register-close/"): Uint8Array {
  const files = sampleSiteFiles(version);
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [prefix + k, strToU8(v)])));
}
