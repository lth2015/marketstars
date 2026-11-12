import Link from "next/link";
import type { Metadata } from "next";
import { facets, listApps, parseListQuery, queryToSearchParams, type ListQuery } from "@/lib/catalog";
import { AppCard } from "@/components/AppCard";
import { AutoSubmit, FilterDrawerButton, FilterDrawerClose, PerPageSelect, SortSelect } from "@/components/FilterDrawer";
import { getMessages } from "@/lib/messages";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getMessages()).ui.list.titleAll };
}

export default async function AppsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const t = await getMessages();
  const L = t.ui.list;
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
  if (q.free) chips.push({ label: L.freePlan, href: reset({ free: false }) });
  if (q.trial) chips.push({ label: L.trialAvail, href: reset({ trial: false }) });
  if (q.recommended) chips.push({ label: L.recommended, href: reset({ recommended: false }) });

  const title = q.trial ? L.titleTrial : q.recommended ? L.titleRecommended : L.titleAll;
  const sortHrefs = Object.fromEntries(["recommended", "new", "price"].map((s) => [s, reset({ sort: s as ListQuery["sort"] })]));
  const perHrefs = Object.fromEntries([10, 30, 50].map((n) => [n, reset({ perPage: n })]));

  return (
    <div className="container">
      <div className="breadcrumb"><Link href="/">{t.nav.home}</Link> ／ {title}</div>
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
        <button type="submit">{t.search}</button>
      </form>

      <div className="list-layout">
        <aside className="filters" aria-label={L.filters}>
          <FilterDrawerClose label={L.close} />
          <form id="filter-form" action="/apps">
            {q.q && <input type="hidden" name="q" value={q.q} />}
            {q.sort !== "recommended" && <input type="hidden" name="sort" value={q.sort} />}
            {q.perPage !== 30 && <input type="hidden" name="per" value={q.perPage} />}
            {q.recommended && <input type="hidden" name="recommended" value="true" />}
            <fieldset>
              <legend>{L.price}</legend>
              <label><input type="checkbox" name="free" value="true" defaultChecked={q.free} />{L.freePlan}</label>
              <label><input type="checkbox" name="trial" value="true" defaultChecked={q.trial} />{L.trialAvail}</label>
            </fieldset>
            <fieldset>
              <legend>{L.category}</legend>
              {f.categories.map((c) => <label key={c.slug}><input type="checkbox" name="category" value={c.slug} defaultChecked={q.category.includes(c.slug)} />{c.name}</label>)}
            </fieldset>
            <fieldset>
              <legend>{L.industry}</legend>
              {f.industries.map((c) => <label key={c.slug}><input type="checkbox" name="industry" value={c.slug} defaultChecked={q.industry.includes(c.slug)} />{c.name}</label>)}
            </fieldset>
            <fieldset>
              <legend>{L.integration}</legend>
              {f.integrations.map((c) => <label key={c.slug}><input type="checkbox" name="integration" value={c.slug} defaultChecked={q.integration.includes(c.slug)} />{c.name}</label>)}
            </fieldset>
            <button className="btn btn-primary btn-block" type="submit">{L.apply}</button>
            <AutoSubmit />
          </form>
        </aside>

        <section aria-live="polite" aria-labelledby="results-h">
          <h2 id="results-h" className="sr-only">{L.results}</h2>
          <div className="list-toolbar">
            <div className="row">
              <strong>{L.count(total)}</strong>
              <FilterDrawerButton count={chips.length} label={L.filterButton(chips.length)} />
            </div>
            <div className="row">
              <SortSelect value={q.sort} hrefs={sortHrefs} labels={{ label: L.sortLabel, recommended: L.sortRecommended, new: L.sortNew, price: L.sortPrice }} />
              <PerPageSelect value={q.perPage} hrefs={perHrefs} label={L.perPageLabel} options={{ 10: L.perPage(10), 30: L.perPage(30), 50: L.perPage(50) }} />
            </div>
          </div>
          {chips.length > 0 && (
            <div className="chips">
              {chips.map((c) => <Link key={c.label} className="chip" href={c.href} aria-label={L.removeChip(c.label)}>{c.label} <span aria-hidden>×</span></Link>)}
              <Link className="chip" href="/apps">{L.clearAll}</Link>
            </div>
          )}
          {items.length === 0 ? (
            <div className="empty">
              <p style={{ fontWeight: 600, color: "var(--text)" }}>{L.emptyTitle}</p>
              <p className="small">{L.emptyHint}</p>
              <Link className="btn btn-secondary" href={`/apps${q.q ? `?q=${encodeURIComponent(q.q)}` : ""}`}>{L.clearFilters}</Link>
            </div>
          ) : (
            <div className="card-grid">{items.map((a) => <AppCard key={a.id} app={a} />)}</div>
          )}
          {pages > 1 && (
            <nav className="pager" aria-label={L.pages}>
              {q.page > 1 && <Link href={`/apps${queryToSearchParams(q, { page: q.page - 1 })}`}>{L.prev}</Link>}
              {Array.from({ length: pages }, (_, i) => i + 1).map((p) =>
                p === q.page ? <span key={p} className="current" aria-current="page">{p}</span> : <Link key={p} href={`/apps${queryToSearchParams(q, { page: p })}`}>{p}</Link>,
              )}
              {q.page < pages && <Link href={`/apps${queryToSearchParams(q, { page: q.page + 1 })}`}>{L.next}</Link>}
            </nav>
          )}
        </section>
      </div>
    </div>
  );
}
