import Anthropic from "@anthropic-ai/sdk";

export const PREMARKET_CLAUDE_MODEL = "claude-sonnet-4-20250514";

export async function streamClaudeText(
  anthropic: Anthropic,
  params: {
    system: string;
    user: string;
    tools?: Anthropic.Messages.MessageCreateParams["tools"];
    toolChoice?: Anthropic.Messages.MessageCreateParams["tool_choice"];
    maxTokens?: number;
    model?: string;
  }
): Promise<string> {
  const stream = anthropic.messages.stream({
    model: params.model ?? PREMARKET_CLAUDE_MODEL,
    max_tokens: params.maxTokens ?? 1400,
    temperature: 0.2,
    system: params.system,
    messages: [{ role: "user", content: params.user }],
    ...(params.tools ? { tools: params.tools, tool_choice: params.toolChoice ?? { type: "auto" } } : {}),
  });
  let text = "";
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      text += event.delta.text;
    }
  }
  return text.trim();
}

/** Extract JSON from model output (optional ```json fence). */
export function parseModelJson<T>(raw: string): T {
  const t = raw.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  const inner = fence ? fence[1].trim() : t;
  return JSON.parse(inner) as T;
}
