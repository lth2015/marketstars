import { redirect } from "next/navigation";
import crypto from "node:crypto";
import { checkEntitlement, generateCopies, getPopSession, marketstars } from "./lib";
import { MarketStarsError } from "@/sdk/marketstars";

export const metadata = { title: "AI POPメーカー" };

async function generate(fd: FormData) {
  "use server";
  const s = await getPopSession();
  if (!s) redirect("/integrations/pop-writer?e=launch");
  const ent = await checkEntitlement(s.t);
  if (!ent.entitled) redirect("/integrations/pop-writer?e=denied");
  const product = String(fd.get("product") ?? "").slice(0, 60);
  const features = String(fd.get("features") ?? "").slice(0, 300);
  const tone = String(fd.get("tone") ?? "friendly");
  const q = new URLSearchParams({ product, features, tone });
  if (fd.get("ai") === "on") {
    // 统一模型网关：按 Token 计费到当前空间
    try {
      const r = await marketstars().messages({
        tenantId: s.t,
        requestId: `pop-${crypto.randomUUID()}`,
        system: "あなたは日本の小売・飲食店の販促コピーライターです。店頭POP用の短いコピーを3案、日本語で、1案2行以内で出力してください。",
        messages: [{ role: "user", content: `商品：${product}\n特徴：${features}\nトーン：${tone}` }],
        maxTokens: 600,
      });
      q.set("ai", r.text.slice(0, 1500));
      q.set("cost", `${r.usage.input_tokens + r.usage.output_tokens} tokens / ¥${r.usage.cost_jpy.toFixed(3)}`);
    } catch (e) {
      q.set("aierr", e instanceof MarketStarsError ? e.message : "AI 生成に失敗しました");
    }
  }
  redirect(`/integrations/pop-writer?${q}`);
}

export default async function PopWriter({ searchParams }: { searchParams: Promise<{ e?: string; product?: string; features?: string; tone?: string; ai?: string; cost?: string; aierr?: string }> }) {
  const sp = await searchParams;
  const s = await getPopSession();
  const ent = s ? await checkEntitlement(s.t) : null;
  const shell = (body: React.ReactNode) => (
    <div style={{ background: "#FFF8EE", minHeight: "70vh", padding: "32px 16px" }}>
      <div style={{ maxWidth: 820, margin: "0 auto" }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 16 }}>
          <h1 style={{ margin: 0, color: "#123A63" }}>AI POPメーカー</h1>
          {s && <span className="small muted">{s.n} ・ {s.tn}{ent?.plan_key ? ` ・ ${ent.plan_key === "free" ? "フリー" : "スタンダード"}` : ""}</span>}
        </div>
        {body}
      </div>
    </div>
  );
  if (!s) return shell(<div className="panel"><p>{sp.e === "denied" ? "この空間には利用権限がありません。MarketStars でお申し込み状況をご確認ください。" : "このアプリは MarketStars の「アプリを開く」から起動してください。"}</p><a className="btn btn-primary" href="/my/apps">MarketStars マイアプリへ</a></div>);
  if (!ent?.entitled) return shell(<div className="alert alert-error">利用期間が終了したか、利用権限がありません（状態：{ent?.status}）。<a href="/my/apps">MarketStars で確認する</a></div>);
  const count = ent.plan_key === "free" ? 2 : 5;
  const copies = sp.product ? generateCopies(sp.product, sp.features ?? "", sp.tone ?? "friendly", count) : [];
  return shell(
    <>
      <form action={generate} className="panel">
        <div className="form-row"><label htmlFor="product">商品名</label><input id="product" name="product" type="text" required defaultValue={sp.product} placeholder="例：北海道バターのクロワッサン" /></div>
        <div className="form-row"><label htmlFor="features">特徴（読点区切り）</label><input id="features" name="features" type="text" defaultValue={sp.features} placeholder="例：サクサク、焼きたて、朝7時から" /></div>
        <div className="form-row"><label htmlFor="tone">トーン</label><select id="tone" name="tone" defaultValue={sp.tone ?? "friendly"}><option value="friendly">親しみやすく</option><option value="premium">上質に</option><option value="urgent">限定感を出す</option></select></div>
        <label className="check" style={{ marginBottom: 12 }}><input type="checkbox" name="ai" defaultChecked={!!sp.ai} /> AI モデルでも提案する（MarketStars モデルゲートウェイ・トークン従量課金）</label>
        <button className="btn btn-primary">{count}パターン作成する</button>
      </form>
      {sp.aierr && <div className="alert alert-error" style={{ marginTop: 16 }}>{sp.aierr}</div>}
      {sp.ai && <div className="panel" style={{ marginTop: 24, whiteSpace: "pre-line" }}><div className="small muted">AI 提案（{sp.cost}）</div><p style={{ fontSize: 17, fontWeight: 600, margin: "8px 0 0" }}>{sp.ai}</p></div>}
      {copies.length > 0 && <div className="stack" style={{ marginTop: 24 }}>{copies.map((c, i) => <div key={i} className="panel" style={{ whiteSpace: "pre-line", fontSize: 18, fontWeight: 600 }}>{c}</div>)}</div>}
      <p className="small muted" style={{ marginTop: 16 }}>※ デモ版はテンプレートベースで生成しています。出力は公開前にご確認ください。</p>
    </>,
  );
}
