import { prisma } from "@/lib/db";
import { getSession, isOperator } from "@/lib/session";
import { audit } from "@/lib/audit";
import { statementCsv } from "@/lib/starpay";

export async function GET(req: Request) {
  const s = await getSession();
  if (!(await isOperator(s))) return new Response("Forbidden", { status: 403 });
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!(await prisma.starpayStatement.findUnique({ where: { id } }))) return new Response("Not found", { status: 404 });
  const csv = await statementCsv(id);
  await audit(prisma, { actorId: s!.userId, actorType: "operator", objectType: "starpay_statement", objectId: id, action: "export_csv" });
  return new Response(csv.body, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${csv.filename}"` } });
}
