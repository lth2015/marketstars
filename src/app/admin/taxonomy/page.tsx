import { prisma } from "@/lib/db";
import { taxonomyAction } from "../actions";
import { Flash } from "@/components/Flash";

export default async function Taxonomy({ searchParams }: { searchParams: Promise<{ msg?: string; error?: string }> }) {
  const sp = await searchParams;
  const inc = { _count: { select: { apps: true } } };
  const groups = [
    { kind: "category", title: "カテゴリ", rows: await prisma.category.findMany({ orderBy: { sortOrder: "asc" }, include: inc }) },
    { kind: "industry", title: "業種", rows: await prisma.industry.findMany({ orderBy: { sortOrder: "asc" }, include: inc }) },
    { kind: "integrationTag", title: "連携サービス", rows: await prisma.integrationTag.findMany({ orderBy: { sortOrder: "asc" }, include: inc }) },
  ];
  const inp = { height: 34, border: "1px solid var(--border)", borderRadius: 8, padding: "0 8px" } as const;
  return (
    <div className="stack">
      <h1>分類・絞り込み</h1>
      <Flash msg={sp.msg} error={sp.error} />
      {groups.map((g) => (
        <div key={g.kind} className="panel stack">
          <h2 style={{ margin: 0 }}>{g.title}</h2>
          {g.rows.map((r) => (
            <div key={r.id} className="row">
              <form action={taxonomyAction} className="row"><input type="hidden" name="kind" value={g.kind} /><input type="hidden" name="op" value="update" /><input type="hidden" name="id" value={r.id} />
                <code className="small">{r.slug}</code><input name="name" defaultValue={r.name} style={inp} aria-label="名称" /><input name="sortOrder" type="number" defaultValue={r.sortOrder} style={{ ...inp, width: 70 }} aria-label="表示順" /><button className="btn btn-secondary btn-sm">保存</button></form>
              <form action={taxonomyAction}><input type="hidden" name="kind" value={g.kind} /><input type="hidden" name="op" value="delete" /><input type="hidden" name="id" value={r.id} /><button className="btn btn-ghost btn-sm">削除</button></form>
              <span className="small muted">{r._count.apps} アプリ</span>
            </div>
          ))}
          <form action={taxonomyAction} className="row"><input type="hidden" name="kind" value={g.kind} /><input type="hidden" name="op" value="create" />
            <input name="slug" placeholder="slug" required style={inp} /><input name="name" placeholder="名称" required style={inp} /><input name="sortOrder" type="number" placeholder="順" style={{ ...inp, width: 70 }} /><button className="btn btn-primary btn-sm">追加</button></form>
        </div>
      ))}
    </div>
  );
}
