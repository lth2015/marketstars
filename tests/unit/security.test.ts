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

import { parseBasic } from "@/lib/api";
const basic = (v: string) => "Basic " + Buffer.from(v).toString("base64");
describe("HTTP Basic（接入应用 client 认证）", () => {
  it("secret 中的冒号不会被截断（RFC 7617：只在第一个冒号处分割）", () => {
    expect(parseBasic(basic("pop-writer:abc:def:ghi"))).toEqual({ id: "pop-writer", secret: "abc:def:ghi" });
  });
  it("缺少 id、secret 或冒号时拒绝", () => {
    expect(parseBasic(basic(":secret"))).toBeNull();
    expect(parseBasic(basic("id:"))).toBeNull();
    expect(parseBasic(basic("nocolon"))).toBeNull();
    expect(parseBasic("Bearer abc")).toBeNull();
  });
});
