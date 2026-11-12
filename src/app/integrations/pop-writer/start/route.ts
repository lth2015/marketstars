import { config } from "@/lib/config";
import { NextResponse, type NextRequest } from "next/server";
import { startPop } from "../lib";

export async function GET(req: NextRequest) {
  const r = await startPop(req.nextUrl.searchParams.get("ms_launch"));
  return NextResponse.redirect(new URL(r === "ok" ? "/integrations/pop-writer" : `/integrations/pop-writer?e=${r}`, config.baseUrl));
}
