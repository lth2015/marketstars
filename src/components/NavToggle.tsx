"use client";
import { useState } from "react";

export function NavToggle({ label = "メニュー" }: { label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm nav-toggle"
      aria-expanded={open}
      aria-controls="main-nav"
      onClick={() => {
        setOpen(!open);
        document.querySelector(".site-header")?.classList.toggle("nav-open");
      }}
    >
      {label}
    </button>
  );
}
