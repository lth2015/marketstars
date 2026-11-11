import { prisma } from "@/lib/db";
import { formatJst } from "@/lib/time";

export default async function Mailbox() {
  const [mails, failedHooks] = await Promise.all([
    prisma.emailOutbox.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.webhookDelivery.count({ where: { status: "dead" } }),
  ]);
  return (
    <div className="stack">
      <h1>メール送信履歴</h1>
      <p className="small muted">送信方式：<code>{process.env.MAIL_TRANSPORT ?? "log"}</code>（log の場合は外部に送信せず、ここにのみ記録します）。Webhook の配信停止（再試行上限）：{failedHooks} 件</p>
      {mails.length === 0 ? <div className="empty">送信履歴はありません。</div> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>作成</th><th>宛先</th><th>件名</th><th>状態</th></tr></thead>
          <tbody>{mails.map((m) => (
            <tr key={m.id}><td className="small">{formatJst(m.createdAt, true)}</td><td className="small">{m.to}</td>
              <td><details><summary>{m.subject}</summary><pre className="small" style={{ whiteSpace: "pre-wrap" }}>{m.body}</pre></details></td>
              <td className="small">{m.status}{m.lastError && <div className="muted">{m.lastError}</div>}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}
