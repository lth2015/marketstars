"use client";
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return <div className="container" style={{ padding: "64px 16px" }}><h1>問題が発生しました</h1><p className="muted">時間をおいて再度お試しください。</p><button className="btn btn-primary" onClick={() => reset()}>再読み込み</button></div>;
}
