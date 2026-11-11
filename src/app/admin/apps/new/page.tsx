import { prisma } from "@/lib/db";
import { createAppAction } from "../../actions";
import { Flash } from "@/components/Flash";

export default async function NewApp({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const providers = await prisma.provider.findMany({ orderBy: { name: "asc" } });
  return (
    <div className="stack">
      <h1>アプリを新規作成</h1>
      <Flash error={(await searchParams).error} />
      <form action={createAppAction} className="panel">
        <div className="form-row"><label htmlFor="name">アプリ名</label><input id="name" name="name" type="text" required /></div>
        <div className="form-row"><label htmlFor="slug">slug（URL）</label><input id="slug" name="slug" type="text" required pattern="[a-z0-9][a-z0-9-]{1,62}" /><div className="hint">公開後は変更できません。例：pop-writer</div></div>
        <div className="form-row"><label htmlFor="providerId">提供会社</label><select id="providerId" name="providerId"><option value="">（新しい提供会社を作成）</option>{providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
        <div className="form-row"><label htmlFor="newProvider">新しい提供会社名</label><input id="newProvider" name="newProvider" type="text" /></div>
        <button className="btn btn-primary">下書きを作成</button>
      </form>
    </div>
  );
}
