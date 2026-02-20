import { NextRequest, NextResponse } from "next/server";
import { requireApiKey, getApiKeyFromRequest } from "@/lib/auth";
import OpenAI from "openai";

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// Simple in-memory rate limit: 10 runs per minute per key (approximate)
const rateLimit = new Map<string, number[]>();
const MAX_PER_MINUTE = 10;
function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const window = 60 * 1000;
  let times = rateLimit.get(key) ?? [];
  times = times.filter((t) => now - t < window);
  if (times.length >= MAX_PER_MINUTE) return false;
  times.push(now);
  rateLimit.set(key, times);
  return true;
}

export async function POST(req: NextRequest) {
  const err = requireApiKey(req);
  if (err) return err;
  const key = getApiKeyFromRequest(req);
  if (key && !checkRateLimit(key)) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429 }
    );
  }
  if (!openai) {
    return NextResponse.json(
      { error: "OpenAI API key not configured" },
      { status: 500 }
    );
  }
  try {
    const body = (await req.json()) as {
      prompt: string;
      symbol: string;
      context?: Record<string, unknown>;
    };
    const { prompt, symbol, context = {} } = body;
    if (!prompt?.trim()) {
      return NextResponse.json({ error: "Missing prompt" }, { status: 400 });
    }
    const contextStr = JSON.stringify({ symbol, ...context }, null, 2);
    const userContent = `Symbol: ${symbol}\n\nContext data:\n${contextStr}\n\nUser prompt/analysis request:\n${prompt}`;
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a concise financial analyst assistant. Provide clear, structured analysis for retail traders. Use bullet points and short paragraphs. Do not give specific buy/sell advice; focus on facts and analysis.",
        },
        { role: "user", content: userContent },
      ],
      max_tokens: 2000,
    });
    const text =
      completion.choices[0]?.message?.content ?? "No response generated.";
    return NextResponse.json({ text });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "AI request failed" },
      { status: 502 }
    );
  }
}
