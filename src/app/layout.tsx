import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Header, Footer } from "@/components/Header";
import { config } from "@/lib/config";
import { FontLoader } from "@/components/FontLoader";

export const metadata: Metadata = {
  title: { default: "MarketStars | お店の仕事に、ちょうどいいAI。", template: "%s | MarketStars" },
  description: "店舗・商業向け AI アプリマーケット MarketStars。",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      </head>
      <body>
        {config.authMode === "demo" && (
          <div style={{ background: "#123A63", color: "#fff", fontSize: 12, textAlign: "center", padding: "4px 8px" }}>
            デモ環境：演示用の合成データと演示ログインを使用しています（本番では共通 SSO を使用）
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
