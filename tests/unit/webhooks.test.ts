import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import { isPrivateAddress, postSigned, signPayload, validateWebhookUrl, verifySignature } from "@/lib/webhooks";

afterEach(() => { delete process.env.WEBHOOK_ALLOW_PRIVATE; });

describe("Webhook 签名", () => {
  it("签名可验证；篡改本文或过期都会失败", () => {
    const body = '{"a":1}';
    const h = signPayload("whsec_x", body);
    expect(verifySignature("whsec_x", body, h)).toBe(true);
    expect(verifySignature("whsec_x", '{"a":2}', h)).toBe(false);
    expect(verifySignature("whsec_y", body, h)).toBe(false);
    expect(verifySignature("whsec_x", body, signPayload("whsec_x", body, Math.floor(Date.now() / 1000) - 600))).toBe(false);
  });
});

describe("SSRF 防护", () => {
  it("内网与元数据地址", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "172.32.0.1", "2001:4860:4860::8888"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });
  it("配置时：要求 https，拒绝内网字面地址与认证信息", () => {
    expect(validateWebhookUrl("http://example.com/x")).not.toBeNull();
    expect(validateWebhookUrl("https://169.254.169.254/latest")).not.toBeNull();
    expect(validateWebhookUrl("https://localhost/x")).not.toBeNull();
    expect(validateWebhookUrl("https://u:p@example.com/x")).not.toBeNull();
    expect(validateWebhookUrl("https://example.com/hook")).toBeNull();
  });
  it("连接时：解析为内网地址的目标被拒绝（DNS rebinding 防护）", async () => {
    const srv = http.createServer((_, res) => res.end("ok")).listen(0, "127.0.0.1");
    await new Promise((r) => srv.once("listening", r));
    const port = (srv.address() as { port: number }).port;
    await expect(postSigned(`http://localhost:${port}/`, "{}", {})).rejects.toThrow(/blocked private address/);
    process.env.WEBHOOK_ALLOW_PRIVATE = "true";
    await expect(postSigned(`http://localhost:${port}/`, "{}", {})).resolves.toMatchObject({ status: 200 });
    srv.close();
  });
});
