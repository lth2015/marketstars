import Link from "next/link";
import { getMessages } from "@/lib/messages";

export default async function NotFound() {
  const E = (await getMessages()).ui.errors;
  return <div className="container" style={{ padding: "64px 16px" }}><h1>{E.notFound}</h1><p className="muted">{E.notFoundBody}</p><Link className="btn btn-primary" href="/apps">{E.toApps}</Link></div>;
}
