import { NextResponse, type NextRequest } from "next/server";
import { sampleZip } from "@/lib/hosting";

/** デモ用：ホスティングにアップロードできるサンプルの静的サイト（レジ締めチェック）。?v=1.1.0 で版を変えられる。 */
export function GET(req: NextRequest) {
  const v = req.nextUrl.searchParams.get("v") ?? "1.0.0";
  const version = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v) ? v : "1.0.0";
  return new NextResponse(new Uint8Array(sampleZip(version)), {
    headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="register-close-${version}.zip"`, "cache-control": "no-store" },
  });
}
