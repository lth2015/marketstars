"use client";
import { useEffect } from "react";

/** 非阻塞加载 Noto Sans JP：首屏先用系统日文字体（font-display: swap），加载完成后替换，避免样式表阻塞渲染。 */
export function FontLoader() {
  useEffect(() => {
    if (document.getElementById("noto-sans-jp")) return;
    const l = document.createElement("link");
    l.id = "noto-sans-jp";
    l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;600;700;800&display=swap";
    document.head.appendChild(l);
  }, []);
  return null;
}
