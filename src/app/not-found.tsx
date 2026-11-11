import Link from "next/link";
export default function NotFound() {
  return <div className="container" style={{ padding: "64px 16px" }}><h1>ページが見つかりません</h1><p className="muted">URL が変更されたか、公開が終了した可能性があります。</p><Link className="btn btn-primary" href="/apps">アプリ一覧へ</Link></div>;
}
