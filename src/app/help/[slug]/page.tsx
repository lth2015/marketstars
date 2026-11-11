import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";

export default async function HelpEntry({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const e = await prisma.contentEntry.findFirst({ where: { slug, kind: { in: ["help", "terms", "privacy"] }, published: true } });
  if (!e) notFound();
  return (
    <div className="container" style={{ maxWidth: 820, paddingBottom: 64 }}>
      <div className="breadcrumb"><Link href="/help">ヘルプ</Link> ／ {e.title}</div>
      <h1 style={{ marginTop: 12 }}>{e.title}</h1>
      {e.kind !== "help" && <p className="small muted">版：{e.version}</p>}
      <div className="panel prose"><p>{e.body}</p></div>
    </div>
  );
}
