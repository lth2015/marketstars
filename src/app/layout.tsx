import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Header, Footer } from "@/components/Header";
import { config } from "@/lib/config";
import { getLocale, messages } from "@/lib/messages";
import { FontLoader } from "@/components/FontLoader";

export function generateMetadata(): Metadata {
  return {
    metadataBase: new URL(config.baseUrl),
    title: { default: "MarketStars | お店の仕事に、ちょうどいいAI。", template: "%s | MarketStars" },
    description: "店舗・商業向け AI アプリマーケット MarketStars。販促、接客、分析、事務の AI アプリを探して、すぐに試せます。",
    openGraph: { type: "website", siteName: "MarketStars", locale: "ja_JP" },
    twitter: { card: "summary" },
  };
}
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale}>
      <head>
      </head>
      <body>
        {config.authMode === "demo" && (
          <aside aria-label="demo" style={{ background: "#123A63", color: "#fff", fontSize: 12, textAlign: "center", padding: "4px 8px" }}>
            {messages[locale].demoBanner}　<a href="/demo" style={{ color: "#fff", fontWeight: 700 }}>{messages[locale].demoGuide}</a>
          </aside>
        )}
        <Header />
        <main id="main">{children}</main>
        <Footer />
        <FontLoader />
      </body>
    </html>
  );
}
