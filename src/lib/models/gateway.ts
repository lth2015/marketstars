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
async function mockChat(r: ChatRequest): Promise<ChatResult> {
  const last = [...r.messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const topic = last.replace(/\s+/g, " ").slice(0, 40);
  const lines = [
    `【AI提案】${topic}`,
    `・お客様の目線で「${topic.slice(0, 12)}」の魅力を一言で伝えましょう。`,
    "・数量や期間の限定感を添えると効果的です。",
    "・最後に来店や購入を後押しする一言を入れましょう。",
  ];
  const text = lines.join("\n").slice(0, r.maxTokens * 2);
  const input = estimateTokens((r.system ?? "") + r.messages.map((m) => m.content).join("\n"));
  return { text, inputTokens: input, outputTokens: estimateTokens(text), model: `${r.model} (mock)`, stopReason: "end_turn" };
}

export async function chat(r: ChatRequest): Promise<ChatResult> {
  return hasAnthropicCredentials() ? anthropicChat(r) : mockChat(r);
}
