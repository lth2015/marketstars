import { redirect } from "next/navigation";
import crypto from "node:crypto";
import { app, draftReplies } from "./lib";
import { MarketStarsError } from "@/sdk/marketstars";
import { getLocale, getMessages } from "@/lib/messages";
import { prisma } from "@/lib/db";

const PROMPT = {
  ja: { system: "あなたは日本の店舗のクチコミ返信を手伝うアシスタントです。丁寧で誠実な返信文を1案、日本語で、5文以内で書いてください。個人情報や事実と異なる約束は書かないでください。", user: (st: string, r: string, t: string) => `店舗名：${st}\n評価：★${r}\nクチコミ：${t}` },
  en: { system: "You help a local shop reply to customer reviews. Write one sincere, polite reply in English, at most 5 sentences. Do not include personal data or promises you cannot keep.", user: (st: string, r: string, t: string) => `Store: ${st}\nRating: ${r}\nReview: ${t}` },
};

export async function generateMetadata() {
  return { title: (await getMessages()).ui.integrations.review.title };
}

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
    const P = PROMPT[await getLocale()];
    // 统一模型网关：按 Token 计费到当前空间（无 API key 时为 mock 模型）
    try {
      const r = await app.marketstars().messages({
        tenantId: s.t,
        requestId: `rr-${crypto.randomUUID()}`,
        system: P.system,
        messages: [{ role: "user", content: P.user(store, rating, review) }],
        maxTokens: 500,
      });
      q.set("ai", r.text.slice(0, 1500));
      q.set("cost", `${r.usage.input_tokens + r.usage.output_tokens} tokens / ¥${r.usage.cost_jpy.toFixed(3)}`);
    } catch (e) {
      q.set("aierr", e instanceof MarketStarsError ? e.message : (await getMessages()).ui.integrations.aiFailed);
    }
  }
  // アプリ自身のデータ：作成履歴を空間（tenant）ごとに保存する
  await prisma.demoAppReviewDraft.create({ data: { tenantId: s.t, userId: s.u, review, rating: Number(rating), tone, store, aiText: q.get("ai") } });
  redirect(`${app.path}?${q}`);
}

type SP = { e?: string; review?: string; rating?: string; tone?: string; store?: string; ai?: string; cost?: string; aierr?: string };

export default async function ReviewReply({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const locale = await getLocale();
  const I = (await getMessages()).ui.integrations;
  const L = I.review;
  const s = await app.getSession();
  const ent = s ? await app.checkEntitlement(s.t) : null;
  const shell = (body: React.ReactNode) => (
    <div style={{ background: "#EEF7F4", minHeight: "70vh", padding: "32px 16px" }}>
      <div style={{ maxWidth: 820, margin: "0 auto" }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 16 }}>
          <h1 style={{ margin: 0, color: "#0F5F53" }}>{L.title}</h1>
          {s && <span className="small muted">{s.n} ・ {s.tn}{ent?.kind === "trial" ? ` ・ ${I.trialBadge}` : ""}</span>}
        </div>
        {body}
      </div>
    </div>
  );
  if (!s) return shell(<div className="panel"><p>{sp.e === "denied" ? I.denied : I.openFromMarket}</p><a className="btn btn-primary" href="/my/apps">{I.toMyApps}</a></div>);
  if (!ent?.entitled) return shell(<div className="alert alert-error">{I.ended(ent?.status ?? "")}<a href="/my/apps">{I.checkMarket}</a></div>);
  const rating = Number(sp.rating ?? 5);
  const history = await prisma.demoAppReviewDraft.findMany({ where: { tenantId: s.t }, orderBy: { createdAt: "desc" }, take: 10 });
  const fmt = new Intl.DateTimeFormat(locale === "en" ? "en-US" : "ja-JP", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Tokyo" });
  const drafts = sp.review ? draftReplies(sp.review, rating, sp.store || s.tn, sp.tone ?? "polite", locale) : [];
  return shell(
    <>
      <form action={draft} className="panel">
        <div className="form-row"><label htmlFor="review">{L.review}</label><textarea id="review" name="review" required maxLength={600} defaultValue={sp.review} placeholder={L.reviewPh} /></div>
        <div className="grid-2">
          <div className="form-row"><label htmlFor="rating">{L.rating}</label><select id="rating" name="rating" defaultValue={String(rating)}>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{"★".repeat(n)}（{n}）</option>)}</select></div>
          <div className="form-row"><label htmlFor="tone">{L.tone}</label><select id="tone" name="tone" defaultValue={sp.tone ?? "polite"}>{(Object.keys(L.tones) as (keyof typeof L.tones)[]).map((k) => <option key={k} value={k}>{L.tones[k]}</option>)}</select></div>
        </div>
        <div className="form-row"><label htmlFor="store">{L.store}</label><input id="store" name="store" type="text" defaultValue={sp.store ?? s.tn} /></div>
        <label className="check" style={{ marginBottom: 12 }}><input type="checkbox" name="ai" defaultChecked={!!sp.ai} /> {L.ai}</label>
        <button className="btn btn-primary">{L.make}</button>
      </form>
      {sp.aierr && <div className="alert alert-error" style={{ marginTop: 16 }}>{sp.aierr}</div>}
      {sp.ai && <div className="panel" style={{ marginTop: 24, whiteSpace: "pre-line" }}><div className="small muted">{L.aiResult(sp.cost ?? "")}</div><p style={{ margin: "8px 0 0" }}>{sp.ai}</p></div>}
      {drafts.length > 0 && (
        <div className="stack" style={{ marginTop: 24 }}>
          {drafts.map((d, i) => <div key={i} className="panel" style={{ whiteSpace: "pre-line" }}><div className="small muted">{L.draft(i + 1)}</div><p style={{ margin: "8px 0 0" }}>{d}</p></div>)}
        </div>
      )}
      <p className="small muted" style={{ marginTop: 16 }}>{L.note}</p>
      <section className="panel" style={{ marginTop: 24 }} aria-labelledby="rr-history">
        <h2 id="rr-history" style={{ fontSize: 18, margin: "0 0 4px" }}>{L.history}</h2>
        <p className="small muted" style={{ margin: "0 0 12px" }}>{L.historyNote(s.tn)}</p>
        {history.length === 0 ? <p className="small muted">{L.historyEmpty}</p> : (
          <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }} data-testid="rr-history">
            {history.map((h) => {
              const q = new URLSearchParams({ review: h.review, rating: String(h.rating), tone: h.tone, store: h.store });
              return (
                <li key={h.id} style={{ borderTop: "1px solid var(--line, #e3e8ef)", paddingTop: 8 }}>
                  <div className="small muted">{fmt.format(h.createdAt)} ・ {"★".repeat(h.rating)}{h.aiText ? ` ・ ${L.withAi}` : ""}</div>
                  <a href={`${app.path}?${q}`} style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.review}</a>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>,
  );
}
