import Link from "next/link";
import type { CardApp } from "@/lib/catalog";
import { isNew } from "@/lib/catalog";
import { yen } from "@/lib/text";
import { Stars } from "./Stars";

export function PriceText({ app }: { app: Pick<CardApp, "minMonthlyPrice" | "hasFreePlan"> & { plans: { priceType: string }[] } }) {
  if (app.minMonthlyPrice === null) return <span className="price">要問い合わせ</span>;
  if (app.minMonthlyPrice === 0) return <span className="price">無料<small>{app.plans.some((p) => p.priceType === "monthly") ? "プランあり" : ""}</small></span>;
  return <span className="price">{yen(app.minMonthlyPrice)}<small>／月（税込）〜</small></span>;
}

export function AppCard({ app }: { app: CardApp }) {
  const badges: React.ReactNode[] = [];
  if (app.recommendWeight > 0) badges.push(<span key="r" className="tag tag-rec">おすすめ</span>);
  if (isNew(app)) badges.push(<span key="n" className="tag tag-new">NEW</span>);
  return (
    <article className="app-card">
      <div className="top">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="app-icon" src={app.iconUrl ?? "/placeholder-icon.svg"} alt="" width={64} height={64} />
        <div style={{ minWidth: 0 }}>
          {badges.length > 0 && <div className="tags" style={{ marginTop: 0, marginBottom: 4 }}>{badges.slice(0, 2)}</div>}
          <h3><Link href={`/apps/${app.slug}`}>{app.name}</Link></h3>
          <div className="provider">{app.provider.name}</div>
          <Stars value={app.ratingAvg} count={app.ratingCount} size={13} />
        </div>
      </div>
      <p className="desc">{app.tagline}</p>
      <div className="tags" style={{ marginBottom: 14 }}>
        {app.categories.slice(0, 2).map((c) => <span key={c.slug} className="tag">{c.name}</span>)}
      </div>
      <div className="foot">
        <PriceText app={app} />
        {app.hasTrial && <span className="tag tag-trial">{app.maxTrialDays}日間無料体験</span>}
      </div>
    </article>
  );
}
