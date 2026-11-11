import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { ContactForm } from "@/components/ContactForm";
import { getMessages } from "@/lib/messages";

export async function generateMetadata() {
  return { title: (await getMessages()).ui.contact.title };
}

export default async function Contact({ searchParams }: { searchParams: Promise<{ app?: string; type?: string }> }) {
  const sp = await searchParams;
  const t = await getMessages();
  const C = t.ui.contact;
  const s = await getSession();
  const apps = await prisma.app.findMany({ where: { status: "published" }, select: { slug: true, name: true }, orderBy: { name: "asc" } });
  return (
    <div className="container" style={{ maxWidth: 820, paddingBottom: 64 }}>
      <div className="breadcrumb"><Link href="/">{t.nav.home}</Link> ／ {C.title}</div>
      <h1 style={{ marginTop: 12 }}>{C.title}</h1>
      {sp.type === "account_deletion" && <div className="alert alert-info">{C.deletionHintPre}<Link href="/account/deletion">{C.deletionHintLink}</Link>{C.deletionHintPost}</div>}
      <ContactForm labels={C.form} apps={apps} defaults={{ app: sp.app, type: sp.type, name: s?.userName, email: s?.email ?? undefined }} />
    </div>
  );
}
