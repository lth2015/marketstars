import Link from "next/link";
import type { Metadata } from "next";
import { facets, listApps, parseListQuery, queryToSearchParams, type ListQuery } from "@/lib/catalog";
import { AppCard } from "@/components/AppCard";
import { AutoSubmit, FilterDrawerButton, FilterDrawerClose, PerPageSelect, SortSelect } from "@/components/FilterDrawer";
import { getMessages } from "@/lib/messages";

export const metadata: Metadata = { title: "アプリ一覧" };

export default async function AppsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const t = await getMessages();
  const q = parseListQuery(await searchParams);
  const [{ total, items, pages }, f] = await Promise.all([listApps(q), facets()]);
  const reset = (patch: Partial<ListQuery>) => `/apps${queryToSearchParams(q, { ...patch, page: 1 })}`;

  const chips: { label: string; href: string }[] = [];
  if (q.q) chips.push({ label: `「${q.q}」`, href: reset({ q: "" }) });
  for (const [key, list] of [["category", f.categories], ["industry", f.industries], ["integration", f.integrations]] as const) {
    for (const v of q[key]) {
      const name = list.find((x) => x.slug === v)?.name ?? v;
      chips.push({ label: name, href: reset({ [key]: q[key].filter((x) => x !== v) }) });
    }
  }
  if (q.free) chips.push({ label: "無料プランあり", href: reset({ free: false }) });
  if (q.trial) chips.push({ label: "無料体験あり", href: reset({ trial: false }) });
  if (q.recommended) chips.push({ label: "おすすめ", href: reset({ recommended: false }) });

  const title = q.trial ? "無料体験できるアプリ" : q.recommended ? "おすすめのアプリ" : "アプリ一覧";
  const sortHrefs = Object.fromEntries(["recommended", "new", "price"].map((s) => [s, reset({ sort: s as ListQuery["sort"] })]));
  const perHrefs = Object.fromEntries([10, 30, 50].map((n) => [n, reset({ perPage: n })]));

  return (
    <div className="container">
      <div className="breadcrumb"><Link href="/">ホーム</Link> ／ {title}</div>
      <h1 style={{ marginTop: 12 }}>{title}</h1>
      <form action="/apps" className="big-search" role="search" style={{ maxWidth: "100%", boxShadow: "none" }}>
        <input name="q" defaultValue={q.q} placeholder={t.searchPlaceholder} aria-label={t.searchPlaceholder} />
        {q.category.map((v) => <input key={v} type="hidden" name="category" value={v} />)}
        {q.industry.map((v) => <input key={v} type="hidden" name="industry" value={v} />)}
        {q.integration.map((v) => <input key={v} type="hidden" name="integration" value={v} />)}
        {q.free && <input type="hidden" name="free" value="true" />}
        {q.trial && <input type="hidden" name="trial" value="true" />}
        {q.recommended && <input type="hidden" name="recommended" value="true" />}
        {q.sort !== "recommended" && <input type="hidden" name="sort" value={q.sort} />}
        <button type="submit">検索</button>
      </form>

      <div className="list-layout">
        <aside className="filters" aria-label="絞り込み条件">
          <FilterDrawerClose />
          <form id="filter-form" action="/apps">
            {q.q && <input type="hidden" name="q" value={q.q} />}
            {q.sort !== "recommended" && <input type="hidden" name="sort" value={q.sort} />}
            {q.perPage !== 30 && <input type="hidden" name="per" value={q.perPage} />}
            {q.recommended && <input type="hidden" name="recommended" value="true" />}
            <fieldset>
              <legend>料金</legend>
              <label><input type="checkbox" name="free" value="true" defaultChecked={q.free} />無料プランあり</label>
              <label><input type="checkbox" name="trial" value="true" defaultChecked={q.trial} />無料体験あり</label>
            </fieldset>
            <fieldset>
              <legend>カテゴリ</legend>
              {f.categories.map((c) => <label key={c.slug}><input type="checkbox" name="category" value={c.slug} defaultChecked={q.category.includes(c.slug)} />{c.name}</label>)}
            </fieldset>
            <fieldset>
              <legend>業種</legend>
              {f.industries.map((c) => <label key={c.slug}><input type="checkbox" name="industry" value={c.slug} defaultChecked={q.industry.includes(c.slug)} />{c.name}</label>)}
            </fieldset>
            <fieldset>
              <legend>連携サービス</legend>
              {f.integrations.map((c) => <label key={c.slug}><input type="checkbox" name="integration" value={c.slug} defaultChecked={q.integration.includes(c.slug)} />{c.name}</label>)}
            </fieldset>
            <button className="btn btn-primary btn-block" type="submit">この条件で絞り込む</button>
            <AutoSubmit />
          </form>
        </aside>

        <section aria-live="polite">
          <div className="list-toolbar">
            <div className="row">
              <strong>{total.toLocaleString()} 件</strong>
              <FilterDrawerButton count={chips.length} />
            </div>
            <div className="row">
              <SortSelect value={q.sort} hrefs={sortHrefs} />
              <PerPageSelect value={q.perPage} hrefs={perHrefs} />
            </div>
          </div>
          {chips.length > 0 && (
            <div className="chips">
              {chips.map((c) => <Link key={c.label} className="chip" href={c.href} aria-label={`${c.label} の条件を外す`}>{c.label} <span aria-hidden>×</span></Link>)}
              <Link className="chip" href="/apps">すべてクリア</Link>
            </div>
          )}
          {items.length === 0 ? (
            <div className="empty">
              <p style={{ fontWeight: 600, color: "var(--text)" }}>条件に合うアプリが見つかりませんでした</p>
              <p className="small">キーワードを変えるか、絞り込み条件を外してお試しください。</p>
              <Link className="btn btn-secondary" href={`/apps${q.q ? `?q=${encodeURIComponent(q.q)}` : ""}`}>絞り込み条件をクリア</Link>
            </div>
          ) : (
            <div className="card-grid">{items.map((a) => <AppCard key={a.id} app={a} />)}</div>
          )}
          {pages > 1 && (
            <nav className="pager" aria-label="ページ">
              {q.page > 1 && <Link href={`/apps${queryToSearchParams(q, { page: q.page - 1 })}`}>前へ</Link>}
              {Array.from({ length: pages }, (_, i) => i + 1).map((p) =>
                p === q.page ? <span key={p} className="current" aria-current="page">{p}</span> : <Link key={p} href={`/apps${queryToSearchParams(q, { page: p })}`}>{p}</Link>,
              )}
              {q.page < pages && <Link href={`/apps${queryToSearchParams(q, { page: q.page + 1 })}`}>次へ</Link>}
            </nav>
          )}
        </section>
      </div>
    </div>
  );
}
