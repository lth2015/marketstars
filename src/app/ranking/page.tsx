import Link from "next/link";
import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { getRanking } from "@/lib/catalog";
import { formatJst } from "@/lib/time";
import { PriceText } from "@/components/AppCard";

export const metadata: Metadata = { title: "利用開始ランキング" };

export default async function RankingPage({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  const { category } = await searchParams;
  const [cats, r] = await Promise.all([prisma.category.findMany({ orderBy: { sortOrder: "asc" } }), getRanking(category)]);
  return (
    <div className="container" style={{ paddingBottom: 64 }}>
      <div className="breadcrumb"><Link href="/">ホーム</Link> ／ ランキング</div>
      <h1 style={{ marginTop: 12 }}>利用開始ランキング</h1>
      <p className="muted small">集計方法：直近30日間に新たに利用を開始した空間（店舗）数。無料体験・社内テスト・取り下げ／お申し込み不可は含みません。同じ空間は1アプリにつき1回のみ集計します。1時間ごとに更新。{r.computedAt && `最終集計：${formatJst(r.computedAt, true)}`}</p>
      <div className="chips" role="tablist" aria-label="カテゴリ">
        <Link className="chip" href="/ranking" aria-current={!category ? "page" : undefined} style={!category ? { borderColor: "var(--primary)", color: "var(--primary)" } : undefined}>総合</Link>
        {cats.map((c) => (
          <Link key={c.slug} className="chip" href={`/ranking?category=${c.slug}`} aria-current={category === c.slug ? "page" : undefined} style={category === c.slug ? { borderColor: "var(--primary)", color: "var(--primary)" } : undefined}>{c.name}</Link>
        ))}
      </div>
      {r.entries.length < 3 && <div className="alert alert-info">集計中：まだ十分な利用データがありません。現在の件数のみ表示しています。</div>}
      {r.entries.length === 0 ? (
        <div className="empty">このカテゴリのランキングは集計中です。</div>
      ) : (
        r.entries.map((e) => (
          <div className="rank-row" key={e.id}>
            <div className="rank-no">{e.rank}</div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="app-icon" src={e.app.iconUrl ?? "/placeholder-icon.svg"} alt="" />
            <div>
              <Link className="stretch" href={`/apps/${e.app.slug}`} style={{ fontWeight: 700, color: "var(--text)", textDecoration: "none" }}>{e.app.name}</Link>
              <div className="small muted">{e.app.provider.name} ・ <PriceText app={e.app} /></div>
            </div>
            <div className="rank-count small muted">直近30日 {e.count} 空間</div>
          </div>
        ))
      )}
    </div>
  );
}
