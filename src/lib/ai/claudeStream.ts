import Anthropic from "@anthropic-ai/sdk";

export const PREMARKET_CLAUDE_MODEL = "claude-sonnet-4-20250514";

function extractFirstJsonValue(raw: string): string | null {
  const starts: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "{" || ch === "[") starts.push(i);
  }

  for (const start of starts) {
    const stack: string[] = [];
    let inString = false;
    let escaped = false;
    for (let i = start; i < raw.length; i++) {
      const ch = raw[i];
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === "\"") inString = false;
        continue;
      }

      if (ch === "\"") {
        inString = true;
        continue;
      }
      if (ch === "{" || ch === "[") {
        stack.push(ch === "{" ? "}" : "]");
        continue;
      }
      if (ch === "}" || ch === "]") {
        if (stack.length === 0) break;
        const expected = stack.pop();
        if (expected !== ch) break;
        if (stack.length === 0) {
          return raw.slice(start, i + 1);
        }
      }
    }
  }
  return null;
}

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
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [t];
  if (fence) candidates.push(fence[1].trim());

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      const recovered = extractFirstJsonValue(candidate);
      if (!recovered) continue;
      try {
        return JSON.parse(recovered) as T;
      } catch {
        /* try next candidate */
      }
    }
  }

  throw new Error("Model output did not contain valid JSON");
}
