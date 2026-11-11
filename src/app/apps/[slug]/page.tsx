import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { getSession, isOperator } from "@/lib/session";
import { getDeveloper } from "@/lib/developer";
import { liveSubscription } from "@/lib/subscriptions";
import { computeCta } from "@/lib/cta";
import { priceLabel } from "@/lib/text";
import { formatJst } from "@/lib/time";
import { isNew } from "@/lib/catalog";
import { PriceText } from "@/components/AppCard";
import { getMessages } from "@/lib/messages";
import { canReview, maskName } from "@/lib/reviews";
import { ReviewForm } from "@/components/ReviewForm";
import { Stars } from "@/components/Stars";

type Overview = { problem?: string; features?: string[]; prerequisites?: string; dataNeeds?: string; setup?: string[]; limitations?: string };
type Shot = { url: string; alt: string };

async function load(slug: string, preview: boolean) {
  const app = await prisma.app.findUnique({
    where: { slug },
    include: { provider: true, categories: { orderBy: { sortOrder: "asc" } }, industries: { orderBy: { sortOrder: "asc" } }, integrationTags: true, plans: { where: { current: true }, orderBy: { sortOrder: "asc" } }, cases: { where: { kind: "case", published: true } } },
  });
  if (!app) return null;
  if (app.status !== "published" && !preview) return null;
  return app;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const app = await load((await params).slug, false);
  return { title: app?.name ?? "アプリ" };
}

export default async function AppDetail({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ preview?: string }> }) {
  const { slug } = await params;
  const session = await getSession();
  const wantPreview = (await searchParams).preview === "1";
  const dev = wantPreview ? await getDeveloper(session) : null;
  const isOp = wantPreview && !!(await isOperator(session));
  let app = await load(slug, wantPreview && (isOp || !!dev));
  // 开发者只能预览自己提供商的应用
  if (app && wantPreview && !isOp && app.providerId !== dev?.id && app.status !== "published") app = null;
  const preview = !!app && wantPreview && (isOp || app.providerId === dev?.id);
  if (!app) notFound();

  // 运营预览草稿：用草稿内容覆盖展示
  const draft = preview && app.draft ? (app.draft as Record<string, unknown>) : null;
  const view = { ...app, ...(draft ?? {}) } as typeof app;
  const overview = (view.overview ?? {}) as Overview;
  const shots = ((view.screenshots ?? []) as Shot[]).filter((s) => s?.url);

  const live = session?.tenantId ? await liveSubscription(session.tenantId, app.id) : null;
  const trialUsed = session?.tenantId ? !!(await prisma.trialUsage.findUnique({ where: { tenantId_appId: { tenantId: session.tenantId, appId: app.id } } })) : false;
  const lastEnded = session?.tenantId && !live ? await prisma.subscription.findFirst({ where: { tenantId: session.tenantId, appId: app.id }, orderBy: { createdAt: "desc" } }) : null;
  const t = await getMessages();
  const cta = computeCta({ app, plans: app.plans, session, live, trialUsed, lastEnded, m: t });
  const support = (app.supportChannels ?? []) as { type: string; value: string }[];
  const reviews = await prisma.review.findMany({ where: { appId: app.id, status: "published" }, orderBy: { createdAt: "desc" }, take: 20 });
  const eligible = await canReview(session, app.id);
  const mine = session ? await prisma.review.findUnique({ where: { appId_userId: { appId: app.id, userId: session.userId } } }) : null;

  const CtaButton = ({ block }: { block?: boolean }) =>
    cta.disabled || !cta.href ? (
      <button className={`btn btn-primary ${block ? "btn-block" : ""}`} disabled aria-describedby="cta-note">{cta.label}</button>
    ) : (
      // 普通链接：目标可能是有副作用的 /launch 路由，不能让 Next 预取
      <a className={`btn ${cta.variant === "secondary" ? "btn-secondary" : "btn-primary"} ${block ? "btn-block" : ""}`} href={cta.href}>{cta.label}</a>
    );

  return (
    <div className="container">
      {preview && <div className="alert alert-warn" style={{ marginTop: 16 }}>運営プレビュー：{draft ? "未公開の下書き内容を表示しています。" : `ステータス ${app.status}`}</div>}
      <div className="breadcrumb"><Link href="/">ホーム</Link> ／ <Link href="/apps">アプリ一覧</Link> ／ {view.name}</div>
      <div className="detail-layout">
        <div>
          <div className="detail-head">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="app-icon" src={view.iconUrl ?? "/placeholder-icon.svg"} alt={`${view.name} のアイコン`} />
            <div>
              <div className="tags" style={{ marginTop: 0 }}>
                {app.recommendWeight > 0 && <span className="tag tag-rec">おすすめ</span>}
                {isNew(app) && <span className="tag tag-new">NEW</span>}
                {app.categories.map((c) => <Link key={c.slug} className="tag" href={`/apps?category=${c.slug}`}>{c.name}</Link>)}
              </div>
              <h1 style={{ marginTop: 6 }}>{view.name}</h1>
              <div className="muted">{app.provider.name} <Stars value={app.ratingAvg} count={app.ratingCount} /></div>
              <p style={{ margin: "12px 0 0" }}>{view.tagline}</p>
              <div className="small muted" style={{ marginTop: 8 }}>対象業種：{app.industries.map((i) => i.name).join("・") || "—"} ／ 連携：{app.integrationTags.map((i) => i.name).join("・") || "—"}</div>
              {app.integrationType === "external" && <div className="alert alert-info small" style={{ marginTop: 12, marginBottom: 0 }}>外部サービスです。アプリを開いた後、提供会社のサービスで別途ログインが必要な場合があります。</div>}
            </div>
          </div>

          <nav className="anchor-nav" aria-label="ページ内">
            <a href="#overview">概要</a><a href="#plans">料金プラン</a><a href="#reviews">レビュー</a><a href="#cases">導入事例</a><a href="#support">サポート</a>
          </nav>

          {shots.length > 0 ? (
            <div className="gallery" aria-label="スクリーンショット">
              {shots.map((s, i) => (
                <a key={i} href={`#shot-${i}`} aria-label={`${s.alt}を拡大`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.url} alt={s.alt} width={1280} height={800} loading={i === 0 ? "eager" : "lazy"} fetchPriority={i === 0 ? "high" : "auto"} decoding="async" />
                </a>
              ))}
            </div>
          ) : (
            <div className="empty small">スクリーンショットは準備中です</div>
          )}
          {shots.map((s, i) => (
            <div key={i} id={`shot-${i}`} className="lightbox" role="dialog" aria-label={s.alt}>
              <a className="close" href="#overview" aria-label="閉じる">×</a>
              {i > 0 && <a href={`#shot-${i - 1}`} className="btn btn-sm" style={{ position: "absolute", left: 16 }}>前へ</a>}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.url} alt={s.alt} loading="lazy" decoding="async" />
              {i < shots.length - 1 && <a href={`#shot-${i + 1}`} className="btn btn-sm" style={{ position: "absolute", right: 16 }}>次へ</a>}
            </div>
          ))}

          <section id="overview" className="section">
            <h2>概要</h2>
            <div className="panel prose">
              {overview.problem && <><h3>解決できること</h3><p>{overview.problem}</p></>}
              {!!overview.features?.length && <><h3>主な機能</h3><ul>{overview.features.map((f) => <li key={f}>{f}</li>)}</ul></>}
              <dl className="dl" style={{ marginTop: 16 }}>
                {overview.prerequisites && <><dt>利用の前提</dt><dd>{overview.prerequisites}</dd></>}
                {overview.dataNeeds && <><dt>利用するデータ</dt><dd>{overview.dataNeeds}</dd></>}
                {!!overview.setup?.length && <><dt>設定の流れ</dt><dd><ol style={{ margin: 0, paddingLeft: 20 }}>{overview.setup.map((s) => <li key={s}>{s}</li>)}</ol></dd></>}
                {overview.limitations && <><dt>制限事項</dt><dd>{overview.limitations}</dd></>}
              </dl>
            </div>
          </section>

          <section id="plans" className="section">
            <h2>料金プラン</h2>
            <div className="plan-grid">
              {app.plans.map((p) => (
                <div key={p.id} className="plan-card">
                  <h3>{p.name}</h3>
                  <div className="price">{priceLabel(p)}</div>
                  {p.priceType === "monthly" && <div className="small muted">{t.perTenant}</div>}
                  {p.tokenPriceJpyPerMTok > 0 && <div className="small" style={{ marginTop: 4 }}>＋ AI 従量：¥{p.tokenPriceJpyPerMTok.toLocaleString()} / 100万トークン（月末締め）</div>}
                  {p.trialDays > 0 && p.priceType !== "free" && <div style={{ marginTop: 8 }}><span className="tag tag-trial">{p.trialDays}日間無料体験</span><div className="small muted" style={{ marginTop: 4 }}>体験終了後に自動課金はありません</div></div>}
                  <div className="prose small" style={{ marginTop: 12 }}><p>{p.includes}</p>{p.limits && <p className="muted">{p.limits}</p>}</div>
                  {p.externalContractRequired && <div className="alert alert-warn small" style={{ marginBottom: 0 }}>提供会社との別途契約が必要です</div>}
                </div>
              ))}
            </div>
          </section>

          <section id="reviews" className="section">
            <div className="section-head"><h2 style={{ margin: 0 }}>レビュー</h2><Stars value={app.ratingAvg} count={app.ratingCount} size={16} /></div>
            {reviews.length === 0 && <div className="empty small">まだレビューはありません。</div>}
            <div className="stack">
              {reviews.map((r) => (
                <article key={r.id} className="panel">
                  <div className="row" style={{ justifyContent: "space-between" }}><Stars value={r.rating} count={1} /><span className="small muted">{maskName(r.userName)} ・ {formatJst(r.createdAt)}</span></div>
                  <h3 style={{ margin: "6px 0" }}>{r.title}</h3>
                  <p style={{ margin: 0, whiteSpace: "pre-line" }}>{r.body}</p>
                  {r.replyBody && <div className="alert alert-info small" style={{ margin: "12px 0 0" }}><strong>提供会社からの返信</strong><br />{r.replyBody}</div>}
                </article>
              ))}
            </div>
            <div style={{ marginTop: 16 }}>
              {eligible ? <ReviewForm appId={app.id} slug={app.slug} initial={mine ? { rating: mine.rating, title: mine.title, body: mine.body } : undefined} />
                : <p className="small muted">レビューは、この空間でアプリを利用したことのある方が投稿できます。{mine?.status === "hidden" && "（あなたのレビューは運営により非表示になっています）"}</p>}
            </div>
          </section>

          <section id="cases" className="section">
            <h2>導入事例</h2>
            {app.cases.length === 0 ? <div className="empty small">公開できる導入事例はまだありません。</div> : app.cases.map((c) => (
              <div key={c.id} className="panel" style={{ marginBottom: 12 }}><h3>{c.title}</h3><p className="small muted">{c.summary}</p><p style={{ margin: 0 }}>{c.body}</p></div>
            ))}
          </section>

          <section id="support" className="section" style={{ paddingBottom: 32 }}>
            <h2>サポート</h2>
            <div className="panel">
              <dl className="dl">
                <dt>提供会社</dt><dd>{app.provider.name}</dd>
                {support.map((s) => <><dt key={s.type + "t"}>{s.type === "email" ? "メール" : s.type === "hours" ? "受付時間" : s.type}</dt><dd key={s.type + "v"}>{s.value}</dd></>)}
                {app.privacyUrl && <><dt>プライバシー</dt><dd><a href={app.privacyUrl}>プライバシーポリシー</a></dd></>}
                {app.termsUrl && <><dt>利用規約</dt><dd><a href={app.termsUrl}>利用規約</a></dd></>}
                {app.version && <><dt>バージョン</dt><dd>{app.version}</dd></>}
                <dt>更新日</dt><dd>{formatJst(app.contentUpdatedAt ?? app.updatedAt)}</dd>
              </dl>
              <div style={{ marginTop: 16 }}><Link href={`/contact?app=${app.slug}`} className="btn btn-secondary btn-sm">このアプリについて問い合わせる</Link></div>
            </div>
          </section>
        </div>

        <aside className="action-box">
          <div className="panel stack">
            <div><div className="small muted">料金</div><PriceText app={app} /></div>
            {app.hasTrial && <span className="tag tag-trial">{app.maxTrialDays}日間無料体験あり</span>}
            {session && <div className="small muted">申込先の空間：<strong style={{ color: "var(--text)" }}>{session.tenantName}</strong></div>}
            {live && <div className="small">現在の状態：<span className={`badge st-${live.status}`}>{live.status === "trialing" ? `無料体験中（${formatJst(live.trialEndsAt)}まで）` : live.status === "pending" ? "申込中" : live.status === "cancel_scheduled" ? `解約予定（${formatJst(live.cancelAt)}）` : live.status === "suspended" ? "一時停止中" : "利用中"}</span></div>}
            <div className="cta-main"><CtaButton block /></div>
            {cta.note && <p id="cta-note" className="small muted" style={{ margin: 0 }}>{cta.note}</p>}
            {live && (live.status === "trialing" || (live.status === "active" && live.kind === "free")) && session?.isOwner && app.plans.some((p) => p.priceType === "monthly") && <Link className="btn btn-secondary btn-block" href={`/my/apps/${live.id}#change`}>有料プランに切り替える</Link>}
          </div>
        </aside>
      </div>
      <div className="mobile-cta"><CtaButton block /></div>
    </div>
  );
}
