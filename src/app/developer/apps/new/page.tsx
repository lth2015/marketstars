import Link from "next/link";
import { devCreateAppAction } from "../../actions";
import { Flash } from "@/components/Flash";

export default async function DevNewApp({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  return (
    <div className="container" style={{ maxWidth: 720, paddingBottom: 64 }}>
      <div className="breadcrumb"><Link href="/developer">開発者ポータル</Link> ／ 新しいアプリ</div>
      <h1 style={{ marginTop: 12 }}>新しいアプリ</h1>
      <Flash error={(await searchParams).error} />
      <form action={devCreateAppAction} className="panel">
        <div className="form-row"><label htmlFor="name">アプリ名</label><input id="name" name="name" type="text" required /></div>
        <div className="form-row"><label htmlFor="slug">slug（URL）</label><input id="slug" name="slug" type="text" required pattern="[a-z0-9][a-z0-9\-]{1,62}" /><div className="hint">英小文字・数字・ハイフン。公開後は変更できません。</div></div>
        <button className="btn btn-primary">下書きを作成</button>
      </form>
    </div>
  );
}
