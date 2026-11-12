import { prisma } from "@/lib/db";
import { getSession, isOperator } from "@/lib/session";
import { exportStatement } from "@/lib/starpay";

export async function GET(req: Request) {
  const s = await getSession();
  if (!(await isOperator(s))) return new Response("Forbidden", { status: 403 });
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!(await prisma.starpayStatement.findUnique({ where: { id } }))) return new Response("Not found", { status: 404 });
  // 初回の出力で明細を確定（以後は追加しない）。再ダウンロードは同じ内容を返す。
  const csv = await exportStatement({ userId: s!.userId }, id);
  return new Response(csv.body, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${csv.filename}"` } });
}
