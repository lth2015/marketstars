import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, isOperator } from "@/lib/session";
import { getDeveloper } from "@/lib/developer";
import { isEntitled } from "@/lib/subscriptions";
import { checkPath } from "@/lib/hosting";

/**
 * MarketStars ホスティングの配信。
 * - 本番：/hosted/{slug}/{path}  … アプリの本番ビルド（App.hostedBuildId）
 * - プレビュー：/hosted/{slug}/~{buildId}/{path} … 提供会社のメンバーと運営のみ
 * HTML（＝画面）を開くときは、利用中の空間の権利（または提供会社・運営）を毎回確認する。
 * CSS/JS/画像は権利確認なしで配信する（不透明オリジンの文書からの読み込みには Cookie が付かないため）。
 * すべての応答に CSP sandbox（allow-same-origin なし）を付け、MarketStars のオリジンとして動かさない。
 */
const CSP = [
  "sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads",
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(status: number, title: string, body: string) {
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title></head><body style="font-family:system-ui,sans-serif;max-width:560px;margin:48px auto;padding:0 16px;color:#1B2B3A"><h1 style="font-size:20px">${esc(title)}</h1><p>${esc(body)}</p><p><a href="/my/apps">マイアプリへ</a></p></body></html>`;
  return new NextResponse(html, { status, headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": CSP, "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" } });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string; path?: string[] }> }) {
  const { slug, path: parts = [] } = await params;
  const app = await prisma.app.findUnique({ where: { slug }, select: { id: true, slug: true, status: true, integrationType: true, providerId: true, hostedBuildId: true, suspendedReason: true } });
  if (!app) return page(404, "ページが見つかりません", "このアプリは存在しません。");
  let segs = parts.map((p) => decodeURIComponent(p));
  let buildId = app.hostedBuildId;
  const preview = segs[0]?.startsWith("~") ? segs[0].slice(1) : null;
  if (preview) { buildId = preview; segs = segs.slice(1); }
  if (!segs.length) return NextResponse.redirect(new URL(`/hosted/${app.slug}/${preview ? `~${preview}/` : ""}index.html`, req.nextUrl.origin), 302);
  const path = segs.join("/");
  if (checkPath(path)) return page(400, "不正なパスです", "このパスは開けません。");
  if (!buildId) return page(404, "公開中のビルドがありません", "提供会社がまだアプリを公開していません。");
  if (!preview && (app.status !== "published" || app.integrationType !== "hosted")) return page(404, "ページが見つかりません", "このアプリは現在公開されていません。");

  const file = await prisma.hostedFile.findFirst({ where: { buildId, path, build: { appId: app.id, status: "ready" } } });
  if (!file) return page(404, "ページが見つかりません", "ファイルが見つかりません。");
  const html = file.contentType.startsWith("text/html");

  if (html) {
    const s = await getSession();
    if (!s) return page(401, "ログインが必要です", "MarketStars にログインし、マイアプリから開いてください。");
    const provider = await getDeveloper(s);
    const staff = provider?.id === app.providerId || !!(await isOperator(s));
    if (preview) {
      if (!staff) return page(403, "プレビューを表示できません", "プレビューは提供会社のメンバーと運営だけが表示できます。");
    } else if (!staff) {
      if (app.suspendedReason) return page(403, "一時停止中です", "このアプリは現在一時停止中です。");
      const sub = s.tenantId ? await prisma.subscription.findFirst({ where: { appId: app.id, tenantId: s.tenantId, liveKey: { not: null } } }) : null;
      if (!sub || !isEntitled(sub)) return page(403, "このアプリを利用する権限がありません", `現在の空間（${s.tenantName ?? "未選択"}）では、このアプリを利用できません。MarketStars でお申し込みください。`);
    }
  }
  return new NextResponse(new Uint8Array(file.data), {
    headers: {
      "content-type": file.contentType,
      "content-security-policy": CSP,
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "cache-control": html || preview ? "private, no-store" : "public, max-age=300",
      etag: `"${file.sha256}"`,
    },
  });
}
