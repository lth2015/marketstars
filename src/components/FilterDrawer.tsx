"use client";
import { useEffect } from "react";

/** 手机/平板的「絞り込み」抽屉；桌面端为常驻侧栏。 */
export function FilterDrawerButton({ count, label }: { count: number; label: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && document.body.classList.remove("filters-open");
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <button type="button" className="btn btn-secondary btn-sm filter-drawer-toggle" onClick={() => document.body.classList.add("filters-open")}>
      {label}
    </button>
  );
}

export function FilterDrawerClose({ label }: { label: string }) {
  return (
    <button type="button" className="btn btn-ghost btn-sm filter-drawer-toggle" onClick={() => document.body.classList.remove("filters-open")} style={{ marginBottom: 12 }}>
      {label}
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

export function SortSelect({ value, hrefs, labels }: { value: string; hrefs: Record<string, string>; labels: { label: string; recommended: string; new: string; price: string } }) {
  return (
    <select aria-label={labels.label} value={value} onChange={(e) => (window.location.href = hrefs[e.target.value])}>
      <option value="recommended">{labels.recommended}</option>
      <option value="new">{labels.new}</option>
      <option value="price">{labels.price}</option>
    </select>
  );
}

export function PerPageSelect({ value, hrefs, label, options }: { value: number; hrefs: Record<string, string>; label: string; options: Record<number, string> }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => (window.location.href = hrefs[e.target.value])}>
      {[10, 30, 50].map((n) => <option key={n} value={n}>{options[n]}</option>)}
    </select>
  );
}
