import { describe, expect, it } from "vitest";
import { clientIp } from "@/lib/ratelimit";

describe("客户端 IP（X-Forwarded-For）", () => {
  it("没有可信代理时完全忽略 XFF（防伪造）", () => {
    expect(clientIp("1.2.3.4", 0)).toBe("direct");
    expect(clientIp(null, 0)).toBe("direct");
  });
  it("GCP LB（1 跳）：取 LB 追加的客户端 IP，忽略客户端伪造的前缀", () => {
    expect(clientIp("203.0.113.9, 198.51.100.7", 1)).toBe("203.0.113.9");
    expect(clientIp("6.6.6.6, 203.0.113.9, 198.51.100.7", 1)).toBe("203.0.113.9");
    expect(clientIp("198.51.100.7", 1)).toBe("unknown");
  });
});
