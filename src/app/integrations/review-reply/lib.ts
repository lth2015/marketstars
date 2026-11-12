// 示范接入应用「クチコミ返信アシスタント」（第 2 款接入应用）。与 AI POPメーカー 相同：
// 只通过 MarketStars 公开 API 与自身 client secret 交互，每次生成前复查权益。
import { integrationApp } from "@/lib/integration-demo";

export const app = integrationApp("review-reply");

export { draftReplies } from "./draft";
