import { redirect } from "next/navigation";
import crypto from "node:crypto";
import { app, draftReplies } from "./lib";
import { MarketStarsError } from "@/sdk/marketstars";

export const metadata = { title: "クチコミ返信アシスタント" };

async function draft(fd: FormData) {
  "use server";
  const s = await app.getSession();
  if (!s) redirect(`${app.path}?e=launch`);
  const ent = await app.checkEntitlement(s.t);
  if (!ent.entitled) redirect(`${app.path}?e=denied`);
  const review = String(fd.get("review") ?? "").slice(0, 600);
  const rating = String(Math.min(5, Math.max(1, Number(fd.get("rating")) || 5)));
  const tone = String(fd.get("tone") ?? "polite");
  const store = String(fd.get("store") ?? s.tn).slice(0, 40);
  const q = new URLSearchParams({ review, rating, tone, store });
  if (fd.get("ai") === "on") {
    // 统一模型网关：按 Token 计费到当前空间（无 API key 时为 mock 模型）
    try {
      const r = await app.marketstars().messages({
        tenantId: s.t,
        requestId: `rr-${crypto.randomUUID()}`,
        system: "あなたは日本の店舗のクチコミ返信を手伝うアシスタントです。丁寧で誠実な返信文を1案、日本語で、5文以内で書いてください。個人情報や事実と異なる約束は書かないでください。",
        messages: [{ role: "user", content: `店舗名：${store}\n評価：★${rating}\nクチコミ：${review}` }],
        maxTokens: 500,
      });
      q.set("ai", r.text.slice(0, 1500));
      q.set("cost", `${r.usage.input_tokens + r.usage.output_tokens} tokens / ¥${r.usage.cost_jpy.toFixed(3)}`);
    } catch (e) {
      q.set("aierr", e instanceof MarketStarsError ? e.message : "AI 生成に失敗しました");
    }
  }
  redirect(`${app.path}?${q}`);
}

type SP = { e?: string; review?: string; rating?: string; tone?: string; store?: string; ai?: string; cost?: string; aierr?: string };

export default async function ReviewReply({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const s = await app.getSession();
  const ent = s ? await app.checkEntitlement(s.t) : null;
  const shell = (body: React.ReactNode) => (
    <div style={{ background: "#EEF7F4", minHeight: "70vh", padding: "32px 16px" }}>
      <div style={{ maxWidth: 820, margin: "0 auto" }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 16 }}>
          <h1 style={{ margin: 0, color: "#0F5F53" }}>クチコミ返信アシスタント</h1>
          {s && <span className="small muted">{s.n} ・ {s.tn}{ent?.kind === "trial" ? " ・ 無料体験中" : ""}</span>}
        </div>
        {body}
      </div>
    </div>
  );
  if (!s) return shell(<div className="panel"><p>{sp.e === "denied" ? "この空間には利用権限がありません。MarketStars でお申し込み状況をご確認ください。" : "このアプリは MarketStars の「アプリを開く」から起動してください。"}</p><a className="btn btn-primary" href="/my/apps">MarketStars マイアプリへ</a></div>);
  if (!ent?.entitled) return shell(<div className="alert alert-error">利用期間が終了したか、利用権限がありません（状態：{ent?.status}）。<a href="/my/apps">MarketStars で確認する</a></div>);
  const rating = Number(sp.rating ?? 5);
  const drafts = sp.review ? draftReplies(sp.review, rating, sp.store || s.tn, sp.tone ?? "polite") : [];
  return shell(
    <>
      <form action={draft} className="panel">
        <div className="form-row"><label htmlFor="review">クチコミ本文</label><textarea id="review" name="review" required maxLength={600} defaultValue={sp.review} placeholder="例：料理は美味しかったけど、少し待ち時間が長かったです。" /></div>
        <div className="grid-2">
          <div className="form-row"><label htmlFor="rating">評価</label><select id="rating" name="rating" defaultValue={String(rating)}>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{"★".repeat(n)}（{n}）</option>)}</select></div>
          <div className="form-row"><label htmlFor="tone">トーン</label><select id="tone" name="tone" defaultValue={sp.tone ?? "polite"}><option value="polite">丁寧に</option><option value="friendly">親しみやすく</option><option value="brief">簡潔に</option></select></div>
        </div>
        <div className="form-row"><label htmlFor="store">署名に使う店舗名</label><input id="store" name="store" type="text" defaultValue={sp.store ?? s.tn} /></div>
        <label className="check" style={{ marginBottom: 12 }}><input type="checkbox" name="ai" defaultChecked={!!sp.ai} /> AI モデルでも返信案を作る（MarketStars モデルゲートウェイ・トークン従量課金）</label>
        <button className="btn btn-primary">返信案を作る</button>
      </form>
      {sp.aierr && <div className="alert alert-error" style={{ marginTop: 16 }}>{sp.aierr}</div>}
      {sp.ai && <div className="panel" style={{ marginTop: 24, whiteSpace: "pre-line" }}><div className="small muted">AI 返信案（{sp.cost}）</div><p style={{ margin: "8px 0 0" }}>{sp.ai}</p></div>}
      {drafts.length > 0 && (
        <div className="stack" style={{ marginTop: 24 }}>
          {drafts.map((d, i) => <div key={i} className="panel" style={{ whiteSpace: "pre-line" }}><div className="small muted">返信案 {i + 1}</div><p style={{ margin: "8px 0 0" }}>{d}</p></div>)}
        </div>
      )}
      <p className="small muted" style={{ marginTop: 16 }}>※ デモ版はテンプレートベースで作成しています。投稿前に内容をご確認ください。</p>
    </>,
  );
}
