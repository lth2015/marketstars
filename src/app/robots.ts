import type { MetadataRoute } from "next";
import { config } from "@/lib/config";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/my", "/api", "/auth", "/developer", "/pay", "/launch", "/integrations", "/locale"] }],
    sitemap: `${config.baseUrl}/sitemap.xml`,
  };
}
