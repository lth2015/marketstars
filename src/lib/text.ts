/** 搜索归一化：去前后空格、NFKC（全半角统一）、小写、平假名→片假名。 */
export function normalizeSearch(s: string): string {
  return s
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .replace(/\s+/g, " ");
}

export function yen(n: number): string {
  return `¥${n.toLocaleString("ja-JP")}`;
}

export function priceLabel(p: { priceType: string; priceJpy: number }): string {
  if (p.priceType === "free") return "無料";
  if (p.priceType === "contact") return "要問い合わせ";
  return `${yen(p.priceJpy)}／月（税込）`;
}

/** 只允许 https（开发环境允许 http://localhost）。 */
export function isSafeLaunchUrl(u: string): boolean {
  try {
    const url = new URL(u);
    if (url.protocol === "https:") return true;
    // 本地/演示：允许与 MarketStars 同源的 http 地址（例如 http://localhost:3000）
    const base = new URL(process.env.APP_BASE_URL ?? "http://localhost:3000");
    if (base.protocol === "http:" && url.origin === base.origin) return true;
    return process.env.NODE_ENV !== "production" && url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

/** 认证回跳只允许站内相对路径。 */
export function safeReturnTo(v: string | null | undefined): string {
  if (!v || !v.startsWith("/") || v.startsWith("//") || v.includes("\\")) return "/";
  // URL パーサはタブ・改行を取り除くため「/<TAB>/evil.com」が「//evil.com」になる：制御文字・空白を含むものは拒否
  if (/[\x00-\x20\x7f]/.test(v)) return "/";
  // 同一オリジンに解決できることを確認し、パス・クエリ・ハッシュだけを返す
  try {
    const base = "http://return-to.invalid";
    const u = new URL(v, base);
    if (u.origin !== base) return "/";
    return u.pathname + u.search + u.hash;
  } catch {
    return "/";
  }
}

/** 按当前语言显示套餐价格；`price` 传 `(await getMessages()).ui.price`。 */
export function localizedPrice(p: { priceType: string; priceJpy: number }, price: { free: string; contact: string; perMonth: string }): string {
  if (p.priceType === "free") return price.free;
  if (p.priceType === "contact") return price.contact;
  return `${yen(p.priceJpy)}${price.perMonth}`;
}
