import { prisma } from "@/lib/db";
import { Flash } from "@/components/Flash";
import { contentSaveAction, providerSaveAction } from "../actions";

export default async function Content({ searchParams }: { searchParams: Promise<{ msg?: string; error?: string }> }) {
  const sp = await searchParams;
  const [entries, apps, providers] = await Promise.all([
    prisma.contentEntry.findMany({ orderBy: [{ kind: "asc" }, { sortOrder: "asc" }] }),
    prisma.app.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.provider.findMany({ orderBy: { name: "asc" } }),
  ]);
  const Editor = ({ e }: { e?: (typeof entries)[number] }) => (
    <form action={contentSaveAction} className="stack">
      {e && <input type="hidden" name="id" value={e.id} />}
      <div className="grid-2">
        <div className="form-row"><label>種別</label><select name="kind" defaultValue={e?.kind ?? "help"}><option value="help">ヘルプ</option><option value="case">導入事例</option><option value="topic">特集（本文＝アプリ slug をカンマ区切り）</option><option value="terms">利用規約</option><option value="privacy">プライバシー</option></select></div>
        <div className="form-row"><label>slug</label><input name="slug" type="text" defaultValue={e?.slug} required /></div>
        <div className="form-row"><label>タイトル</label><input name="title" type="text" defaultValue={e?.title} required /></div>
        <div className="form-row"><label>関連アプリ（事例）</label><select name="appId" defaultValue={e?.appId ?? ""}><option value="">なし</option>{apps.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
        <div className="form-row"><label>版</label><input name="version" type="text" defaultValue={e?.version ?? "1"} /></div>
        <div className="form-row"><label>表示順</label><input name="sortOrder" type="number" defaultValue={e?.sortOrder ?? 0} /></div>
      </div>
      <div className="form-row"><label>要約</label><input name="summary" type="text" defaultValue={e?.summary ?? ""} /></div>
      <div className="form-row"><label>本文（テキスト）</label><textarea name="body" defaultValue={e?.body} /></div>
      <label className="check"><input type="checkbox" name="published" defaultChecked={e?.published ?? true} />公開する</label>
      <div><button className="btn btn-primary btn-sm">保存</button></div>
    </form>
  );
  return (
    <div className="stack">
      <h1>コンテンツ</h1>
      <Flash msg={sp.msg} error={sp.error} />
      <p className="small muted">導入事例は掲載許可を得た実在の事例のみ公開してください。本文は HTML として解釈されません。</p>
      {entries.map((e) => <details key={e.id} className="panel"><summary style={{ cursor: "pointer" }}><strong>[{e.kind}]</strong> {e.title} {e.published ? "" : "（非公開）"}</summary><div style={{ marginTop: 12 }}><Editor e={e} /></div></details>)}
      <details className="panel"><summary style={{ cursor: "pointer", fontWeight: 700 }}>＋ 新しいコンテンツ</summary><div style={{ marginTop: 12 }}><Editor /></div></details>
      <h2>提供会社</h2>
      {[...providers, undefined].map((p, i) => (
        <form key={p?.id ?? `new-${i}`} action={providerSaveAction} className="panel row">
          {p && <input type="hidden" name="id" value={p.id} />}
          {(["name", "websiteUrl", "supportUrl", "supportEmail"] as const).map((k) => <input key={k} name={k} defaultValue={p?.[k] ?? ""} placeholder={k} aria-label={k} style={{ height: 34, border: "1px solid var(--border)", borderRadius: 8, padding: "0 8px", flex: 1, minWidth: 140 }} />)}
          <button className="btn btn-secondary btn-sm">{p ? "保存" : "追加"}</button>
        </form>
      ))}
    </div>
  );
}
