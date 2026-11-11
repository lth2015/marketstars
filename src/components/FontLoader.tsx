"use client";
import { useEffect } from "react";

/**
 * 自托管 Noto Sans JP 的非阻塞加载：页面 load 之后再插入样式表（按 unicode-range 分片，只下载用到的字）。
 * 首屏先用系统日文字体（font-display: swap），避免约 200KB 的 @font-face 定义阻塞渲染。
 */
export function FontLoader() {
  useEffect(() => {
    const add = () => {
      if (document.getElementById("noto-sans-jp")) return;
      const l = document.createElement("link");
      l.id = "noto-sans-jp";
      l.rel = "stylesheet";
      l.href = "/fonts/noto-sans-jp.css";
      document.head.appendChild(l);
    };
    if (document.readyState === "complete") add();
    else window.addEventListener("load", add, { once: true });
  }, []);
  return null;
}
