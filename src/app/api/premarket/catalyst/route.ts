import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { fetchStockNews } from "@/lib/massive";
import {
  isNewsInPremarketWindow,
  priorTradingSessionYmdEt,
  todayYmdEt,
} from "@/lib/premarket-news-window";

export const runtime = "nodejs";

const SONNET_MODEL = "claude-sonnet-4-20250514";
const MAX_SYMBOLS = 12;
const NEWS_FETCH_LIMIT = 50;

function normalizeSymbols(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const x of raw) {
    const s = String(x ?? "")
      .toUpperCase()
      .trim();
    if (/^[A-Z][A-Z0-9.\-]{0,9}$/.test(s) && !out.includes(s)) out.push(s);
  }
  return out.slice(0, MAX_SYMBOLS);
}

function parseModelJsonSummary(raw: string): string {
  let t = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/m.exec(t);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end < start) return "No news";
  try {
    const o = JSON.parse(t.slice(start, end + 1)) as { summary?: unknown };
    const s = o.summary != null ? String(o.summary).trim() : "";
    return s.length > 0 ? s : "No news";
  } catch {
    return "No news";
  }
}

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const body = (await req.json().catch(() => ({}))) as { symbols?: unknown };
  const symbols = normalizeSymbols(body.symbols);
  if (symbols.length === 0) {
    return NextResponse.json({ error: "symbols array required" }, { status: 400 });
  }

  const now = new Date();
  const todayYmd = todayYmdEt(now);
  const priorYmd = priorTradingSessionYmdEt(now);

  type Row = { summary: string };
  const results: Record<string, Row> = {};

  const anthropic = apiKey ? new Anthropic({ apiKey }) : null;

  for (const symbol of symbols) {
    let items;
    try {
      items = await fetchStockNews(symbol, NEWS_FETCH_LIMIT);
    } catch {
      results[symbol] = { summary: "No news" };
      continue;
    }

    const filtered = items.filter((n) =>
      isNewsInPremarketWindow(n.publishedUtc ?? n.publishedDate ?? "", todayYmd, priorYmd)
    );

    if (filtered.length === 0) {
      results[symbol] = { summary: "No news" };
      continue;
    }

    if (!anthropic) {
      results[symbol] = {
        summary: filtered.length > 0 ? "Catalyst unavailable" : "No news",
      };
      continue;
    }

    const articlesBlock = filtered
      .slice(0, 24)
      .map((a, i) => {
        const title = (a.title ?? "").replace(/\s+/g, " ").trim();
        const desc = (a.text ?? "").replace(/\s+/g, " ").trim().slice(0, 400);
        const url = a.url && /^https?:\/\//i.test(a.url) ? a.url : "";
        const src = (a.source ?? "").trim();
        return `[${i + 1}] ${title}${src ? ` (${src})` : ""}\n    ${desc}\n    URL: ${url}`;
      })
      .join("\n\n");

    const userPrompt = `Ticker: ${symbol}

You are helping a trader understand why the stock may be gapping up in pre-market.

**Allowed news dates (America/New_York calendar only):** ${priorYmd} and ${todayYmd}.
The articles below have ALREADY been restricted to those two dates. Do not infer or use anything older.

**Articles (only use these):**
${articlesBlock}

**Task:** Identify which item(s) — if any — plausibly explain a gap-up move for ${symbol}. If none are relevant, respond with summary exactly: No news

**Output rules:**
- Return ONLY valid JSON: {"summary":"..."} 
- summary: at most 1–2 sentences.
- When citing a source, include a markdown link: [publisher or short title](full_url) using ONLY URLs from the articles above.
- If nothing is relevant: {"summary":"No news"}
- No prose outside the JSON object.`;

    try {
      const msg = await anthropic.messages.create({
        model: SONNET_MODEL,
        max_tokens: 500,
        messages: [{ role: "user", content: userPrompt }],
      });
      const block = msg.content[0];
      const text = block && block.type === "text" ? block.text : "";
      const summary = parseModelJsonSummary(text);
      results[symbol] = { summary };
    } catch {
      results[symbol] = { summary: "No news" };
    }
  }

  return NextResponse.json({
    results,
    window: { todayYmd, priorSessionYmd: priorYmd, timezone: "America/New_York" },
  });
}
