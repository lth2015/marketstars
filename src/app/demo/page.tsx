import { notFound } from "next/navigation";
import { config } from "@/lib/config";
import { getSession } from "@/lib/session";
import { DEMO_PERSONAS } from "@/lib/demo-identities";
import { DEMO_SCENARIOS, type DemoStep } from "@/lib/demo-scenarios";

export const metadata = { title: "デモガイド", robots: { index: false } };

function who(step: DemoStep) {
  if (!step.as) return "ゲスト（ログアウトして開きます）";
  const p = DEMO_PERSONAS.find((x) => x.userId === step.as!.userId);
  const t = p?.tenants.find((x) => x.id === step.as!.tenantId);
  return `${p?.name ?? "?"} ／ ${t?.name ?? "?"}（${t?.owner ? "オーナー" : "メンバー"}）`;
}

export default async function DemoGuide({ searchParams }: { searchParams: Promise<{ reset?: string; error?: string }> }) {
  if (config.authMode !== "demo") notFound();
  const sp = await searchParams;
  const s = await getSession();
  return (
    <div className="container" style={{ maxWidth: 960, paddingBottom: 64 }}>
      <h1 style={{ marginTop: 24 }}>デモガイド</h1>
      <p className="muted">
        MarketStars の主な流れを順番にたどれます。各手順の「開く」を押すと、指定の利用者・空間でログインし直して該当ページを開きます。データはすべて合成データです。
      </p>
      <p className="small">現在：{s ? <strong>{s.userName} ／ {s.tenantName}（{s.isOwner ? "オーナー" : "メンバー"}）</strong> : "ゲスト"}</p>
      {sp.reset && <div className="alert alert-ok" role="status">デモデータを初期状態に戻しました。すべての利用者はログアウトされています。</div>}
      {sp.error === "confirm" && <div className="alert alert-error" role="alert">確認のチェックを入れてください。</div>}

      <nav aria-label="シナリオ" className="chips" style={{ margin: "16px 0 24px" }}>
        {DEMO_SCENARIOS.map((sc) => <a key={sc.id} className="chip" href={`#${sc.id}`}>{sc.title.split("：")[0].replace(/^\d+\.\s*/, "")}</a>)}
      </nav>

      <div className="stack">
        {DEMO_SCENARIOS.map((sc) => (
          <section key={sc.id} id={sc.id} className="panel stack" aria-labelledby={`h-${sc.id}`}>
            <h2 id={`h-${sc.id}`} style={{ fontSize: 20, margin: 0 }}>{sc.title}</h2>
            <p className="small muted" style={{ margin: 0 }}>{sc.summary}</p>
            <ol className="stack" style={{ margin: 0, paddingLeft: 20 }}>
              {sc.steps.map((st, i) => (
                <li key={i}>
                  <form action="/auth/demo" method="post" className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                    {st.as ? <><input type="hidden" name="userId" value={st.as.userId} /><input type="hidden" name="tenantId" value={st.as.tenantId} /></> : <input type="hidden" name="guest" value="1" />}
                    <input type="hidden" name="returnTo" value={st.path} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <strong>{st.title}</strong>
                      <div className="small muted">{who(st)}</div>
                      <div className="small">{st.hint}</div>
                    </div>
                    <button className="btn btn-secondary btn-sm" aria-label={`${st.title} を開く`}>開く</button>
                  </form>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>

      <section className="panel stack" style={{ marginTop: 32 }} aria-labelledby="h-reset">
        <h2 id="h-reset" style={{ fontSize: 20, margin: 0 }}>デモデータを初期状態に戻す</h2>
        <p className="small muted" style={{ margin: 0 }}>申し込み・契約・請求・レビュー・掲載申請などをすべて消して、最初の状態に戻します。この環境を使っている全員がログアウトされます。</p>
        <form action="/demo/reset" method="post" className="row" style={{ gap: 12 }}>
          <label className="check"><input type="checkbox" name="confirm" required /> <span>初期状態に戻すことを確認しました</span></label>
          <button className="btn btn-danger btn-sm">初期状態に戻す</button>
        </form>
      </section>
    </div>
  );
}
