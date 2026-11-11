import crypto from "node:crypto";
import { prisma } from "./db";
import type { AppDraft } from "./publishing";

const MAX = 2 * 1024 * 1024;

/** 只接受 PNG / JPEG / WebP（按文件头判断，不信任扩展名和 Content-Type）；不接受 SVG（可含脚本）。 */
function sniff(b: Buffer): string | null {
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 12 && b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

export class UploadError extends Error {}

export async function saveImage(file: File, owner: { type: "provider" | "operator"; id: string }) {
  if (file.size > MAX) throw new UploadError(`${file.name}：2MB 以下の画像にしてください。`);
  const buf = Buffer.from(await file.arrayBuffer());
  const type = sniff(buf);
  if (!type) throw new UploadError(`${file.name}：PNG / JPEG / WebP のみアップロードできます。`);
  const a = await prisma.asset.create({ data: { ownerType: owner.type, ownerId: owner.id, contentType: type, size: buf.length, sha256: crypto.createHash("sha256").update(buf).digest("hex"), data: buf } });
  return `/api/assets/${a.id}`;
}

/** 处理草稿表单中的 iconFile / screenshotFiles。 */
export async function applyUploads(fd: FormData, d: AppDraft, owner: { type: "provider" | "operator"; id: string }) {
  const icon = fd.get("iconFile");
  if (icon instanceof File && icon.size > 0) d.iconUrl = await saveImage(icon, owner);
  for (const f of fd.getAll("screenshotFiles")) {
    if (f instanceof File && f.size > 0) {
      if (d.screenshots.length >= 8) throw new UploadError("スクリーンショットは8枚までです。");
      d.screenshots.push({ url: await saveImage(f, owner), alt: f.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 80) || "スクリーンショット" });
    }
  }
  return d;
}
