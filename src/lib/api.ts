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

/** 接入应用的服务端认证：HTTP Basic client_id:client_secret（secret 来自 Secret Manager）。 */
export async function authenticateAppClient(req: Request) {
  const h = req.headers.get("authorization") ?? "";
  if (!h.startsWith("Basic ")) return null;
  const [id, secret] = Buffer.from(h.slice(6), "base64").toString().split(":");
  if (!id || !secret) return null;
  const expected = config.launchSecret(id);
  if (!expected || !safeEqual(secret, expected)) return null;
  return prisma.app.findUnique({ where: { launchClientId: id } });
}

export function bearerOk(req: Request, token: string) {
  const h = req.headers.get("authorization") ?? "";
  return !!token && h.startsWith("Bearer ") && safeEqual(h.slice(7), token);
}
