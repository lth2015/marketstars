import { getMessages } from "@/lib/messages";

export async function StatusBadge({ status }: { status: string }) {
  const m = await getMessages();
  return <span className={`badge st-${status}`}>{m.status[status] ?? status}</span>;
}
