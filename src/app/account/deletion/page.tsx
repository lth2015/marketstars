import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { config } from "@/lib/config";
import { currentRequest, deletionChecks, DELETION_STATUS } from "@/lib/deletion";
import { formatJst } from "@/lib/time";
import { Flash } from "@/components/Flash";
import { submitDeletionAction, withdrawDeletionAction } from "@/app/actions";

export const metadata = { title: "アカウント削除の申請" };

export default async function Deletion({ searchParams }: { searchParams: Promise<{ msg?: string; error?: string }> }) {
  const sp = await searchParams;
  const s = await getSession();
  if (!s) redirect("/auth/login?returnTo=/account/deletion");
  const [checks, req] = await Promise.all([deletionChecks(s), currentRequest(s.userId)]);
  const open = req && ["submitted", "in_review", "forwarded_to_sso"].includes(req.status);
  const blocking = checks.filter((c) => c.blocking && !c.ok);
  return (
    <div className="container" style={{ maxWidth: 860, paddingBottom: 64 }}>
      <div className="breadcrumb"><Link href="/account">アカウント</Link> ／ アカウント削除の申請</div>
      <h1 style={{ marginTop: 12 }}>アカウント削除の申請</h1>
      <Flash msg={sp.msg} error={sp.error} />
      <div className="alert alert-info">
        共通アカウントは MarketStars 以外のアプリでも使われているため、削除は共通 SSO がまとめて行います。MarketStars はお申し込みの受付と事前確認を行い、SSO に引き継ぎます。<strong>このページで申請しても、すぐには削除されません。</strong>
        契約・請求などの取引記録は法令に基づき一定期間保存されます。ログアウトやアプリの解約だけをしたい場合は <Link href="/account">アカウント</Link> ページをご利用ください。
      </div>

      {req && (
        <div className="panel stack" style={{ marginBottom: 24 }}>
          <h2 style={{ margin: 0 }}>申請状況</h2>
          <dl className="dl">
            <dt>状態</dt><dd><strong>{DELETION_STATUS[req.status] ?? req.status}</strong></dd>
            <dt>申請日時</dt><dd>{formatJst(req.createdAt, true)}</dd>
            {req.ssoTicketRef && <><dt>SSO 受付番号</dt><dd>{req.ssoTicketRef}</dd></>}
            {req.operatorNote && <><dt>運営からの連絡</dt><dd>{req.operatorNote}</dd></>}
          </dl>
          {open && req.status !== "forwarded_to_sso" && <form action={withdrawDeletionAction}><input type="hidden" name="id" value={req.id} /><button className="btn btn-secondary btn-sm">申請を取り下げる</button></form>}
        </div>
      )}

      <h2>削除の前に確認が必要な事項</h2>
      <p className="small muted">空間「{s.tenantName}」での状況です。ほかの空間に所属している場合は、空間を切り替えて確認してください。</p>
      <ul className="stack" style={{ listStyle: "none", padding: 0 }}>
        {checks.map((c) => (
          <li key={c.key} className="panel" style={{ display: "flex", gap: 12 }}>
            <span aria-hidden style={{ fontSize: 20 }}>{c.ok ? "✅" : c.blocking ? "⛔" : "ℹ️"}</span>
            <div>
              <strong>{c.title}</strong> <span className="small muted">{c.ok ? "（問題なし）" : c.blocking ? "（対応が必要）" : "（確認）"}</span>
              <p className="small" style={{ margin: "4px 0 0" }}>{c.detail}</p>
              {!c.ok && c.link && <Link className="small" href={c.link}>対応する</Link>}
              {c.key === "owner" && config.sso.consoleUrl && <a className="small" href={config.sso.consoleUrl}>共通アカウントの管理画面を開く</a>}
            </div>
          </li>
        ))}
      </ul>

      {!open && (
        <form action={submitDeletionAction} className="panel stack">
          <h2 style={{ margin: 0 }}>申請する</h2>
          {blocking.length > 0 && <div className="alert alert-warn" style={{ margin: 0 }}>「対応が必要」の項目を解消してから申請してください。</div>}
          <div className="form-row" style={{ margin: 0 }}><label htmlFor="reason">理由（任意）</label><textarea id="reason" name="reason" maxLength={2000} /></div>
          <label className="check"><input type="checkbox" name="confirm" /> <span>共通アカウントが削除されると、MarketStars を含むすべての接続アプリにログインできなくなることを理解しました。</span></label>
          <div><button className="btn btn-danger" disabled={blocking.length > 0}>アカウント削除を申請する</button></div>
        </form>
      )}
    </div>
  );
}
