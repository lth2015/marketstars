import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { getSession, isOperator } from "@/lib/session";
import { getDeveloper } from "@/lib/developer";
import { liveSubscription } from "@/lib/subscriptions";
import { computeCta } from "@/lib/cta";
import { yen } from "@/lib/text";
import { formatJst } from "@/lib/time";
import { isNew } from "@/lib/catalog";
import { PriceText } from "@/components/AppCard";
import { getMessages } from "@/lib/messages";
import { config } from "@/lib/config";
import { headers } from "next/headers";
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
  if (!app) return { title: "アプリ", robots: { index: false } };
  const image = app.iconUrl && /^https:\/\//.test(app.iconUrl) ? [{ url: app.iconUrl }] : undefined;
  return {
    title: app.name,
    description: app.tagline,
    alternates: { canonical: `/apps/${app.slug}` },
    openGraph: { title: `${app.name} | MarketStars`, description: app.tagline, url: `/apps/${app.slug}`, images: image },
  };
}

/** 结构化数据（SoftwareApplication）。评分只在有真实评论时输出。 */
function jsonLd(app: NonNullable<Awaited<ReturnType<typeof load>>>) {
  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: app.name,
    description: app.tagline,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    provider: { "@type": "Organization", name: app.provider.name },
    url: `${config.baseUrl}/apps/${app.slug}`,
  };
  if (app.minMonthlyPrice !== null) data.offers = { "@type": "Offer", price: app.minMonthlyPrice, priceCurrency: "JPY" };
  if (app.ratingCount > 0 && app.ratingAvg !== null) data.aggregateRating = { "@type": "AggregateRating", ratingValue: app.ratingAvg, reviewCount: app.ratingCount };
  // 防止 </script> 截断
  return JSON.stringify(data).replace(/</g, "\\u003c");
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

  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <div className="container">
      {!preview && <script type="application/ld+json" nonce={nonce} dangerouslySetInnerHTML={{ __html: jsonLd(app) }} />}
      {preview && <div className="alert alert-warn" style={{ marginTop: 16 }}>運営プレビュー：{draft ? "未公開の下書き内容を表示しています。" : `ステータス ${app.status}`}</div>}
      <div className="breadcrumb"><Link href="/">{t.nav.home}</Link> ／ <Link href="/apps">{t.nav.apps}</Link> ／ {view.name}</div>
      <div className="detail-layout">
        <div>
          <div className="detail-head">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="app-icon" src={view.iconUrl ?? "/placeholder-icon.svg"} alt="" />
            <div>
              <div className="tags" style={{ marginTop: 0 }}>
                {app.recommendWeight > 0 && <span className="tag tag-rec">{t.ui.badge.recommended}</span>}
                {isNew(app) && <span className="tag tag-new">NEW</span>}
                {app.categories.map((c) => <Link key={c.slug} className="tag" href={`/apps?category=${c.slug}`}>{c.name}</Link>)}
              </div>
              <h1 style={{ marginTop: 6 }}>{view.name}</h1>
              <div className="muted">{app.provider.name} <Stars value={app.ratingAvg} count={app.ratingCount} /></div>
              <p style={{ margin: "12px 0 0" }}>{view.tagline}</p>
              <div className="small muted" style={{ marginTop: 8 }}>{t.ui.detail.industries}：{app.industries.map((i) => i.name).join("・") || "—"} ／ {t.ui.detail.integrations}：{app.integrationTags.map((i) => i.name).join("・") || "—"}</div>
              {app.integrationType === "external" && <div className="alert alert-info small" style={{ marginTop: 12, marginBottom: 0 }}>{t.ui.detail.externalNotice}</div>}
            </div>
          </div>

          <nav className="anchor-nav" aria-label={t.ui.detail.inPage}>
            <a href="#overview">{t.ui.detail.overview}</a><a href="#plans">{t.ui.detail.plans}</a><a href="#reviews">{t.ui.detail.reviews}</a><a href="#cases">{t.ui.detail.cases}</a><a href="#support">{t.ui.detail.support}</a>
          </nav>

          {shots.length > 0 ? (
            <div className="gallery" aria-label={t.ui.detail.screenshots}>
              {shots.map((s, i) => (
                <a key={i} href={`#shot-${i}`} aria-label={t.ui.detail.enlarge(s.alt)}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.url} alt={s.alt} width={1280} height={800} loading={i === 0 ? "eager" : "lazy"} fetchPriority={i === 0 ? "high" : "auto"} decoding="async" />
                </a>
              ))}
            </div>
          ) : (
            <div className="empty small">{t.ui.detail.noScreens}</div>
          )}
          {shots.map((s, i) => (
            <div key={i} id={`shot-${i}`} className="lightbox" role="dialog" aria-label={s.alt}>
              <a className="close" href="#overview" aria-label={t.ui.detail.close}>×</a>
              {i > 0 && <a href={`#shot-${i - 1}`} className="btn btn-sm" style={{ position: "absolute", left: 16 }}>{t.ui.detail.prev}</a>}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.url} alt={s.alt} loading="lazy" decoding="async" />
              {i < shots.length - 1 && <a href={`#shot-${i + 1}`} className="btn btn-sm" style={{ position: "absolute", right: 16 }}>{t.ui.detail.next}</a>}
            </div>
          ))}

          <section id="overview" className="section">
            <h2>{t.ui.detail.overview}</h2>
            <div className="panel prose">
              {overview.problem && <><h3>{t.ui.detail.solves}</h3><p>{overview.problem}</p></>}
              {!!overview.features?.length && <><h3>{t.ui.detail.features}</h3><ul>{overview.features.map((f) => <li key={f}>{f}</li>)}</ul></>}
              <dl className="dl" style={{ marginTop: 16 }}>
                {overview.prerequisites && <><dt>{t.ui.detail.prerequisites}</dt><dd>{overview.prerequisites}</dd></>}
                {overview.dataNeeds && <><dt>{t.ui.detail.dataNeeds}</dt><dd>{overview.dataNeeds}</dd></>}
                {!!overview.setup?.length && <><dt>{t.ui.detail.setup}</dt><dd><ol style={{ margin: 0, paddingLeft: 20 }}>{overview.setup.map((s) => <li key={s}>{s}</li>)}</ol></dd></>}
                {overview.limitations && <><dt>{t.ui.detail.limitations}</dt><dd>{overview.limitations}</dd></>}
              </dl>
            </div>
          </section>

          <section id="plans" className="section">
            <h2>{t.ui.detail.plans}</h2>
            <div className="plan-grid">
              {app.plans.map((p) => (
                <div key={p.id} className="plan-card">
                  <h3>{p.name}</h3>
                  <div className="price">{p.priceType === "free" ? t.ui.price.free : p.priceType === "contact" ? t.ui.price.contact : `${yen(p.priceJpy)}${t.ui.price.perMonth}`}</div>
                  {p.priceType === "monthly" && <div className="small muted">{t.perTenant}</div>}
                  {p.tokenPriceJpyPerMTok > 0 && <div className="small" style={{ marginTop: 4 }}>{t.ui.detail.tokenPrice(`¥${p.tokenPriceJpyPerMTok.toLocaleString()}`)}</div>}
                  {p.trialDays > 0 && p.priceType !== "free" && <div style={{ marginTop: 8 }}><span className="tag tag-trial">{t.ui.price.trialDays(p.trialDays)}</span><div className="small muted" style={{ marginTop: 4 }}>{t.ui.detail.trialNoAuto}</div></div>}
                  <div className="prose small" style={{ marginTop: 12 }}><p>{p.includes}</p>{p.limits && <p className="muted">{p.limits}</p>}</div>
                  {p.externalContractRequired && <div className="alert alert-warn small" style={{ marginBottom: 0 }}>{t.ui.detail.externalContract}</div>}
                </div>
              ))}
            </div>
          </section>

          <section id="reviews" className="section">
            <div className="section-head"><h2 style={{ margin: 0 }}>{t.ui.detail.reviews}</h2><Stars value={app.ratingAvg} count={app.ratingCount} size={16} /></div>
            {reviews.length === 0 && <div className="empty small">{t.ui.detail.noReviews}</div>}
            <div className="stack">
              {reviews.map((r) => (
                <article key={r.id} className="panel">
                  <div className="row" style={{ justifyContent: "space-between" }}><Stars value={r.rating} count={1} /><span className="small muted">{maskName(r.userName)} ・ {formatJst(r.createdAt)}</span></div>
                  <h3 style={{ margin: "6px 0" }}>{r.title}</h3>
                  <p style={{ margin: 0, whiteSpace: "pre-line" }}>{r.body}</p>
                  {r.replyBody && <div className="alert alert-info small" style={{ margin: "12px 0 0" }}><strong>{t.ui.detail.providerReply}</strong><br />{r.replyBody}</div>}
                </article>
              ))}
            </div>
            <div style={{ marginTop: 16 }}>
              {eligible ? <ReviewForm appId={app.id} slug={app.slug} initial={mine ? { rating: mine.rating, title: mine.title, body: mine.body } : undefined} />
                : <p className="small muted">{t.ui.detail.canReviewHint}{mine?.status === "hidden" && "（あなたのレビューは運営により非表示になっています）"}</p>}
            </div>
          </section>

          <section id="cases" className="section">
            <h2>{t.ui.detail.cases}</h2>
            {app.cases.length === 0 ? <div className="empty small">{t.ui.detail.noCases}</div> : app.cases.map((c) => (
              <div key={c.id} className="panel" style={{ marginBottom: 12 }}><h3>{c.title}</h3><p className="small muted">{c.summary}</p><p style={{ margin: 0 }}>{c.body}</p></div>
            ))}
          </section>

          <section id="support" className="section" style={{ paddingBottom: 32 }}>
            <h2>{t.ui.detail.support}</h2>
            <div className="panel">
              <dl className="dl">
                <dt>{t.ui.detail.provider}</dt><dd>{app.provider.name}</dd>
                {support.map((s) => <><dt key={s.type + "t"}>{s.type === "email" ? t.ui.detail.email : s.type === "hours" ? t.ui.detail.hours : s.type}</dt><dd key={s.type + "v"}>{s.value}</dd></>)}
                {app.privacyUrl && <><dt>{t.ui.detail.privacy}</dt><dd><a href={app.privacyUrl}>{t.ui.detail.privacyPolicy}</a></dd></>}
                {app.termsUrl && <><dt>{t.ui.detail.terms}</dt><dd><a href={app.termsUrl}>{t.ui.detail.terms}</a></dd></>}
                {app.version && <><dt>{t.ui.detail.version}</dt><dd>{app.version}</dd></>}
                <dt>{t.ui.detail.updated}</dt><dd>{formatJst(app.contentUpdatedAt ?? app.updatedAt)}</dd>
              </dl>
              <div style={{ marginTop: 16 }}><Link href={`/contact?app=${app.slug}`} className="btn btn-secondary btn-sm">{t.ui.detail.ask}</Link></div>
            </div>
          </section>
        </div>

        <aside className="action-box">
          <div className="panel stack">
            <div><div className="small muted">{t.ui.detail.price}</div><PriceText app={app} /></div>
            {app.hasTrial && <span className="tag tag-trial">{t.ui.detail.trialAvail(app.maxTrialDays)}</span>}
            {session && <div className="small muted">{t.ui.detail.applyingSpace}<strong style={{ color: "var(--text)" }}>{session.tenantName}</strong></div>}
            {live && <div className="small">{t.ui.detail.currentState}<span className={`badge st-${live.status}`}>{t.status[live.status] ?? live.status}{live.status === "trialing" ? `（${formatJst(live.trialEndsAt)}）` : live.status === "cancel_scheduled" ? `（${formatJst(live.cancelAt)}）` : ""}</span></div>}
            <div className="cta-main"><CtaButton block /></div>
            {cta.note && <p id="cta-note" className="small muted" style={{ margin: 0 }}>{cta.note}</p>}
            {live && (live.status === "trialing" || (live.status === "active" && live.kind === "free")) && session?.isOwner && app.plans.some((p) => p.priceType === "monthly") && <Link className="btn btn-secondary btn-block" href={`/my/apps/${live.id}#change`}>{t.ui.detail.switchToPaid}</Link>}
          </div>
        </aside>
      </div>
      <div className="mobile-cta"><CtaButton block /></div>
    </div>
  );
}
