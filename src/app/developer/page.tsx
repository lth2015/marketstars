import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { getDeveloper } from "@/lib/developer";
import { Flash } from "@/components/Flash";
import { Stars } from "@/components/Stars";
import { registerDeveloperAction, updateProviderAction } from "./actions";

export const metadata = { title: "開発者ポータル" };
const REVIEW: Record<string, string> = { none: "未提出", submitted: "審査中", rejected: "差し戻し", approved: "承認済み" };

export default async function DeveloperHome({ searchParams }: { searchParams: Promise<{ msg?: string; error?: string }> }) {
  const sp = await searchParams;
  const s = await getSession();
  if (!s) redirect("/auth/login?returnTo=/developer");
  const p = await getDeveloper(s);
  const Shell = ({ children }: { children: React.ReactNode }) => (
    <div className="container" style={{ maxWidth: 1000, paddingBottom: 64 }}>
      <div className="breadcrumb"><Link href="/">ホーム</Link> ／ 開発者ポータル</div>
      <h1 style={{ marginTop: 12 }}>開発者ポータル</h1>
      <p className="muted small">空間「{s.tenantName}」として、アプリの掲載申請・更新・レビューへの返信ができます。</p>
      <Flash msg={sp.msg} error={sp.error} />
      {children}
    </div>
  );
  if (!p) {
    return (
      <Shell>
        <div className="panel">
          <h2>開発者として登録</h2>
          <p className="small muted">登録した空間が提供会社になります。掲載は運営の審査（内容確認・接続テスト）後に公開されます。</p>
          {!s.isOwner ? <div className="alert alert-warn">登録は空間のオーナーのみ可能です。</div> : (
            <form action={registerDeveloperAction}>
              <div className="grid-2">
                <div className="form-row"><label htmlFor="name">提供会社名</label><input id="name" name="name" type="text" required defaultValue={s.tenantName ?? ""} /></div>
                <div className="form-row"><label htmlFor="contactEmail">運営からの連絡先メール</label><input id="contactEmail" name="contactEmail" type="email" required defaultValue={s.email ?? ""} /></div>
                <div className="form-row"><label htmlFor="supportEmail">利用者向けサポート窓口</label><input id="supportEmail" name="supportEmail" type="email" /></div>
                <div className="form-row"><label htmlFor="websiteUrl">Web サイト</label><input id="websiteUrl" name="websiteUrl" type="url" /></div>
              </div>
              <label className="check" style={{ marginBottom: 16 }}><input type="checkbox" name="agree" required /> MarketStars 開発者規約（デモ版）に同意します</label>
              <button className="btn btn-primary">登録する</button>
            </form>
          )}
        </div>
      </Shell>
    );
  }
  const apps = await prisma.app.findMany({ where: { providerId: p.id }, orderBy: { createdAt: "desc" } });
  const live = await prisma.subscription.groupBy({ by: ["appId"], where: { appId: { in: apps.map((a) => a.id) }, liveKey: { not: null }, status: { not: "pending" }, internalTest: false }, _count: true });
  return (
    <Shell>
      <div className="section-head"><h2 style={{ margin: 0 }}>{p.name} のアプリ</h2><div className="row"><Link className="btn btn-secondary btn-sm" href="/developer/analytics">分析</Link><Link className="btn btn-secondary btn-sm" href="/developer/earnings">売上・精算</Link><Link className="btn btn-primary btn-sm" href="/developer/apps/new">新しいアプリ</Link></div></div>
      {apps.length === 0 ? <div className="empty">まだアプリはありません。</div> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>アプリ</th><th>公開状態</th><th>審査</th><th>利用空間</th><th>評価</th></tr></thead>
          <tbody>{apps.map((a) => (
            <tr key={a.id}>
              <td><Link href={`/developer/apps/${a.id}`}>{a.name}</Link><div className="small muted">{a.slug}</div></td>
              <td>{a.status === "published" ? "公開中" : a.status === "archived" ? "アーカイブ" : "未公開"}{a.draft && a.status === "published" ? "（更新の下書きあり）" : ""}</td>
              <td>{REVIEW[a.reviewStatus] ?? a.reviewStatus}</td>
              <td>{live.find((x) => x.appId === a.id)?._count ?? 0}</td>
              <td><Stars value={a.ratingAvg} count={a.ratingCount} /></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <details className="panel" style={{ marginTop: 32 }}>
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>提供会社情報</summary>
        <form action={updateProviderAction} style={{ marginTop: 12 }}>
          <div className="grid-2">
            <div className="form-row"><label htmlFor="pn">提供会社名</label><input id="pn" name="name" type="text" defaultValue={p.name} /></div>
            <div className="form-row"><label htmlFor="pc">運営からの連絡先</label><input id="pc" name="contactEmail" type="email" defaultValue={p.contactEmail ?? ""} /></div>
            <div className="form-row"><label htmlFor="ps">サポート窓口</label><input id="ps" name="supportEmail" type="email" defaultValue={p.supportEmail ?? ""} /></div>
            <div className="form-row"><label htmlFor="pw">Web サイト</label><input id="pw" name="websiteUrl" type="url" defaultValue={p.websiteUrl ?? ""} /></div>
          </div>
          <button className="btn btn-secondary btn-sm">保存</button>
        </form>
      </details>
    </Shell>
  );
}
