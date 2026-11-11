import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { ContactForm } from "@/components/ContactForm";

export const metadata = { title: "お問い合わせ" };

export default async function Contact({ searchParams }: { searchParams: Promise<{ app?: string; type?: string }> }) {
  const sp = await searchParams;
  const s = await getSession();
  const apps = await prisma.app.findMany({ where: { status: "published" }, select: { slug: true, name: true }, orderBy: { name: "asc" } });
  return (
    <div className="container" style={{ maxWidth: 820, paddingBottom: 64 }}>
      <div className="breadcrumb"><Link href="/">ホーム</Link> ／ お問い合わせ</div>
      <h1 style={{ marginTop: 12 }}>お問い合わせ</h1>
      {sp.type === "account_deletion" && <div className="alert alert-info">アカウント削除の申請は <Link href="/account/deletion">専用ページ</Link> から行えます（ログインが必要です）。確認事項の自動チェックと進捗確認ができます。</div>}
      <ContactForm apps={apps} defaults={{ app: sp.app, type: sp.type, name: s?.userName, email: s?.email ?? undefined }} />
    </div>
  );
}
