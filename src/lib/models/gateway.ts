// 统一模型网关的模型提供方。配置了 Anthropic 凭证时调用 Claude（官方 SDK），否则使用确定性的 mock 模型。
import Anthropic from "@anthropic-ai/sdk";

export type ChatMessage = { role: "user" | "assistant"; content: string };
export type ChatRequest = { model: string; system?: string; messages: ChatMessage[]; maxTokens: number; effort?: "low" | "medium" | "high" };
export type ChatResult = { text: string; inputTokens: number; outputTokens: number; model: string; stopReason: string | null };

export const ALLOWED_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"] as const;
export const DEFAULT_MODEL = () => (process.env.MODEL_GATEWAY_DEFAULT_MODEL as (typeof ALLOWED_MODELS)[number]) || "claude-opus-5-5";

export function hasAnthropicCredentials() {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

let client: Anthropic | null = null;

async function anthropicChat(r: ChatRequest): Promise<ChatResult> {
  client ??= new Anthropic();
  const response = await client.beta.messages.create({
    model: r.model,
    max_tokens: r.maxTokens,
    ...(r.system ? { system: r.system } : {}),
    messages: r.messages,
    output_config: { effort: r.effort ?? "low" },
    // 拒答时由服务端按类别自动切换到可用模型
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });
  if (response.stop_reason === "refusal") {
    return { text: "", inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens, model: response.model, stopReason: "refusal" };
  }
  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  return { text, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens, model: response.model, stopReason: response.stop_reason };
}

/** 确定性 mock：用于演示/测试环境，不访问外部网络。Token 数按字符粗略估算。 */
function estimateTokens(s: string) {
  return Math.max(1, Math.ceil([...s].length / 1.5));
}
/** 「キー：値」形式の行を読み取る（デモの接入アプリはこの形式でプロンプトを送る）。 */
function fields(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([^：:]{1,12})[：:]\s*(.*)$/);
    if (m) out[m[1].trim()] = m[2].trim();
  }
  return out;
}

/** 用途に合わせた決定的な応答（モデル呼び出しの代わり）。用途は system プロンプトで判定する。 */
function mockText(system: string, last: string): string {
  const f = fields(last);
  const en = !/[\u3040-\u30ff]/.test(system); // 英語のプロンプトには英語で答える
  if (/クチコミ|review/i.test(system)) {
    const ratingRaw = f["評価"] ?? f["Rating"] ?? "";
    const stars = ratingRaw.replace(/[^★]/g, "").length || Number(ratingRaw.replace(/\D/g, "")) || 5;
    const store = f["店舗名"] || f["Store"] || (en ? "our store" : "当店");
    const review = f["クチコミ"] ?? f["Review"] ?? "";
    const wait = /待|遅|時間|wait|slow/i.test(review);
    if (en) {
      return stars <= 2
        ? ["[AI suggestion] Thank you for visiting us and for your honest feedback.", wait ? "We are truly sorry for the long wait and the inconvenience it caused." : "We are sorry that we fell short of your expectations.", "We have shared your comments with the whole team and are reviewing how we serve our guests.", `We hope to welcome you again at ${store}.`].join("\n")
        : ["[AI suggestion] Thank you so much for your kind review.", "It is wonderful to hear you enjoyed your visit; the whole team is delighted.", `We look forward to seeing you again at ${store}.`].join("\n");
    }
    return stars <= 2
      ? [`【AI提案】このたびはご来店いただき、また率直なご意見をお寄せいただき、ありがとうございます。`, wait ? "お待たせしてしまい、ご不便をおかけしたことを心よりお詫び申し上げます。" : "ご期待に沿えなかった点があり、申し訳ございません。", "いただいた内容はスタッフ全員で共有し、ご案内の流れを見直してまいります。", `またお越しいただける機会がございましたら、${store}一同、心を込めてお迎えいたします。`].join("\n")
      : [`【AI提案】あたたかいクチコミをありがとうございます。`, "お楽しみいただけたご様子が伝わり、スタッフ一同大変うれしく思っております。", `次回のご来店も、${store}一同心よりお待ちしております。`].join("\n");
  }
  if (/コピー|POP|copy/i.test(system)) {
    const product = f["商品"] || f["Product"] || (en ? "our special" : "おすすめ商品");
    const feats = (f["特徴"] ?? f["Features"] ?? "").split(/[、,]/).map((x) => x.trim()).filter(Boolean);
    const a = feats[0] ?? (en ? "quality" : "こだわり"), b = feats[1] ?? feats[0] ?? (en ? "flavor" : "おいしさ");
    if (en) return ["[AI suggestion]", `1. ${a} you can taste: ${product}.`, `2. ${b}, made for you. Today's pick: ${product}`, `3. One bite says it all. ${product}, now available.`].join("\n");
    return [`【AI提案】`, `1. ${a}がうれしい、${product}。`, `2. ${b}を、あなたに。本日のおすすめ ${product}`, `3. ひと口で伝わる${a}。${product}、はじめました。`].join("\n");
  }
  const topic = last.replace(/\s+/g, " ").slice(0, 40);
  return [`【AI提案】${topic}`, `・お客様の目線で「${topic.slice(0, 12)}」の魅力を一言で伝えましょう。`, "・数量や期間の限定感を添えると効果的です。", "・最後に来店や購入を後押しする一言を入れましょう。"].join("\n");
}

async function mockChat(r: ChatRequest): Promise<ChatResult> {
  const last = [...r.messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const text = mockText(r.system ?? "", last).slice(0, r.maxTokens * 2);
  const input = estimateTokens((r.system ?? "") + r.messages.map((m) => m.content).join("\n"));
  return { text, inputTokens: input, outputTokens: estimateTokens(text), model: `${r.model} (mock)`, stopReason: "end_turn" };
}

export const __test = { mockText };

export async function chat(r: ChatRequest): Promise<ChatResult> {
  return hasAnthropicCredentials() ? anthropicChat(r) : mockChat(r);
}
