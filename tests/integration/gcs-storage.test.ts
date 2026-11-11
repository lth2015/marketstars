// 集成测试：ASSET_STORAGE=gcs 时上传到 Cloud Storage（用 fake-gcs-server 模拟）。
// 需要：STORAGE_EMULATOR_HOST、GCS_ASSETS_BUCKET、GCS_PUBLIC_BASE_URL、DATABASE_URL。未设置时跳过。
//   docker run -d -p 127.0.0.1:4443:4443 fsouza/fake-gcs-server:1.52.2 -scheme http -port 4443 -public-host 127.0.0.1:4443 -external-url http://127.0.0.1:4443
import { describe, expect, it } from "vitest";
import { saveImage, UploadError } from "@/lib/assets";

const enabled = !!(process.env.STORAGE_EMULATOR_HOST && process.env.GCS_ASSETS_BUCKET && process.env.DATABASE_URL);
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

describe.skipIf(!enabled)("GCS 资产存储", () => {
  it("上传到 bucket，返回公开 URL；内容寻址，重复上传得到同一对象", async () => {
    process.env.ASSET_STORAGE = "gcs";
    const owner = { type: "provider" as const, id: "it-test" };
    const url = await saveImage(new File([png], "icon.png", { type: "image/png" }), owner);
    expect(url).toMatch(new RegExp(`/${process.env.GCS_ASSETS_BUCKET}/assets/[0-9a-f]{64}\\.png$`));
    const r = await fetch(url);
    expect(r.status).toBe(200);
    expect(Buffer.from(await r.arrayBuffer()).equals(png)).toBe(true);
    const again = await saveImage(new File([png], "copy.png", { type: "image/png" }), owner);
    expect(again).toBe(url);
  });
  it("伪装成 PNG 的 SVG 在上传前就被拒绝", async () => {
    process.env.ASSET_STORAGE = "gcs";
    await expect(saveImage(new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], "x.png", { type: "image/png" }), { type: "provider", id: "it-test" })).rejects.toBeInstanceOf(UploadError);
  });
});
