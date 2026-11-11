"use client";
import { useEffect, useState } from "react";

// 客户端错误边界拿不到服务端字典：按 <html lang> 选择文案。
const TEXT = {
  ja: { title: "問題が発生しました", body: "時間をおいて再度お試しください。", retry: "再読み込み" },
  en: { title: "Something went wrong", body: "Please try again in a moment.", retry: "Try again" },
};

export default function Error({ reset }: { error: Error; reset: () => void }) {
  const [lang, setLang] = useState<"ja" | "en">("ja");
  useEffect(() => { if (document.documentElement.lang === "en") setLang("en"); }, []);
  const T = TEXT[lang];
  return <div className="container" style={{ padding: "64px 16px" }}><h1>{T.title}</h1><p className="muted">{T.body}</p><button className="btn btn-primary" onClick={() => reset()}>{T.retry}</button></div>;
}
