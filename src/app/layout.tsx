import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Header, Footer } from "@/components/Header";
import { config } from "@/lib/config";
import { getLocale, messages } from "@/lib/messages";
import { FontLoader } from "@/components/FontLoader";

export const metadata: Metadata = {
  title: { default: "MarketStars | お店の仕事に、ちょうどいいAI。", template: "%s | MarketStars" },
  description: "店舗・商業向け AI アプリマーケット MarketStars。",
};
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
          <div style={{ background: "#123A63", color: "#fff", fontSize: 12, textAlign: "center", padding: "4px 8px" }}>
            {messages[locale].demoBanner}
          </div>
        )}
        <Header />
        <main id="main">{children}</main>
        <Footer />
        <FontLoader />
      </body>
    </html>
  );
}
