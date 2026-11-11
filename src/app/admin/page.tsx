import Link from "next/link";
import { prisma } from "@/lib/db";

export default async function AdminHome() {
  const [pending, live, apps, drafts, inquiries, job] = await Promise.all([
    prisma.subscription.count({ where: { status: "pending" } }),
    prisma.subscription.count({ where: { liveKey: { not: null }, status: { not: "pending" } } }),
    prisma.app.count({ where: { status: "published" } }),
    prisma.app.count({ where: { status: "draft" } }),
    prisma.inquiry.count({ where: { status: { not: "closed" } } }),
    prisma.jobLock.findMany(),
  ]);
  const [submissions, failedCharges] = await Promise.all([prisma.app.count({ where: { reviewStatus: "submitted" } }), prisma.paymentIntent.count({ where: { status: "failed", purpose: "renew" } })]);
  const tiles = [
    { label: "未処理の申込", value: pending, href: "/admin/requests" },
    { label: "有効な契約", value: live, href: "/admin/subscriptions" },
    { label: "公開中アプリ", value: apps, href: "/admin/apps" },
    { label: "未対応のお問い合わせ", value: inquiries, href: "/admin/inquiries" },
    { label: "開発者審査待ち", value: submissions, href: "/admin/submissions" },
    { label: "自動更新の決済失敗", value: failedCharges, href: "/admin/subscriptions" },
  ];
  return (
    <div className="stack">
      <h1>ダッシュボード</h1>
      <div className="card-grid cols-auto">
        {tiles.map((t) => <Link key={t.label} href={t.href} className="panel" style={{ textDecoration: "none", color: "var(--text)" }}><div className="small muted">{t.label}</div><div style={{ fontSize: 32, fontWeight: 800 }}>{t.value}</div></Link>)}
      </div>
      <div className="panel small">
        <strong>定期処理</strong>
        <ul style={{ margin: "8px 0 0" }}>{job.length === 0 ? <li>まだ実行されていません</li> : job.map((j) => <li key={j.name}>{j.name}：{j.lastRunAt?.toISOString() ?? "—"} {j.lastResult}</li>)}</ul>
        <p className="muted" style={{ marginBottom: 0 }}>下書き中のアプリ：{drafts} 件</p>
      </div>
    </div>
  );
}
