import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "./db";
import { config } from "./config";

export function problem(status: number, code: string, detail: string) {
  return NextResponse.json({ type: `https://marketstars.example/problems/${code}`, title: code, status, detail }, { status, headers: { "content-type": "application/problem+json" } });
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** 解析 HTTP Basic（RFC 7617：只在第一个冒号处分割，secret 可以包含冒号）。 */
export function parseBasic(header: string): { id: string; secret: string } | null {
  if (!header.startsWith("Basic ")) return null;
  const raw = Buffer.from(header.slice(6), "base64").toString();
  const i = raw.indexOf(":");
  if (i <= 0 || i === raw.length - 1) return null;
  return { id: raw.slice(0, i), secret: raw.slice(i + 1) };
}

/** 接入应用的服务端认证：HTTP Basic client_id:client_secret（secret 来自 Secret Manager）。 */
export async function authenticateAppClient(req: Request) {
  const h = req.headers.get("authorization") ?? "";
  const creds = parseBasic(h);
  if (!creds) return null;
  const { id, secret } = creds;
  const expected = config.launchSecret(id);
  if (!expected || !safeEqual(secret, expected)) return null;
  return prisma.app.findUnique({ where: { launchClientId: id } });
}

export function bearerOk(req: Request, token: string) {
  const h = req.headers.get("authorization") ?? "";
  return !!token && h.startsWith("Bearer ") && safeEqual(h.slice(7), token);
}
