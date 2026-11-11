import { STATUS_LABEL } from "@/lib/subscriptions";
export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge st-${status}`}>{STATUS_LABEL[status] ?? status}</span>;
}
