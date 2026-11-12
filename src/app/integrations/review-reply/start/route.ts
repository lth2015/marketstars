import { config } from "@/lib/config";
import { NextResponse, type NextRequest } from "next/server";
import { app } from "../lib";

export async function GET(req: NextRequest) {
  const r = await app.start(req.nextUrl.searchParams.get("ms_launch"));
  return NextResponse.redirect(new URL(r === "ok" ? app.path : `${app.path}?e=${r}`, config.baseUrl));
}
