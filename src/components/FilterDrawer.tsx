"use client";
import { useEffect } from "react";

/** 手机/平板的「絞り込み」抽屉；桌面端为常驻侧栏。 */
export function FilterDrawerButton({ count }: { count: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && document.body.classList.remove("filters-open");
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <button type="button" className="btn btn-secondary btn-sm filter-drawer-toggle" onClick={() => document.body.classList.add("filters-open")}>
      絞り込み{count > 0 ? `（${count}）` : ""}
    </button>
  );
}

export function FilterDrawerClose() {
  return (
    <button type="button" className="btn btn-ghost btn-sm filter-drawer-toggle" onClick={() => document.body.classList.remove("filters-open")} style={{ marginBottom: 12 }}>
      閉じる
    </button>
  );
}

/** 勾选即提交（无 JS 时仍可点击「この条件で絞り込む」）。 */
export function AutoSubmit() {
  useEffect(() => {
    const form = document.getElementById("filter-form") as HTMLFormElement | null;
    if (!form) return;
    const h = () => { document.body.classList.remove("filters-open"); form.requestSubmit(); };
    form.querySelectorAll("input[type=checkbox]").forEach((el) => el.addEventListener("change", h));
    return () => form.querySelectorAll("input[type=checkbox]").forEach((el) => el.removeEventListener("change", h));
  }, []);
  return null;
}

export function SortSelect({ value, hrefs }: { value: string; hrefs: Record<string, string> }) {
  return (
    <select aria-label="並び順" value={value} onChange={(e) => (window.location.href = hrefs[e.target.value])}>
      <option value="recommended">おすすめ順</option>
      <option value="new">新着順</option>
      <option value="price">価格の安い順</option>
    </select>
  );
}

export function PerPageSelect({ value, hrefs }: { value: number; hrefs: Record<string, string> }) {
  return (
    <select aria-label="表示件数" value={value} onChange={(e) => (window.location.href = hrefs[e.target.value])}>
      {[10, 30, 50].map((n) => <option key={n} value={n}>{n}件</option>)}
    </select>
  );
}
