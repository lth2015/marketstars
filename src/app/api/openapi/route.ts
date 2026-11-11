import { readFile } from "node:fs/promises";
import path from "node:path";

export async function GET() {
  const body = await readFile(path.join(process.cwd(), "api", "marketstars.openapi.yaml"), "utf8");
  return new Response(body, { headers: { "content-type": "application/yaml; charset=utf-8" } });
}
