import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { fetchStockNews } from "@/lib/massive";
import {
  normalizeCatalystFromApi,
  type PremarketCatalystEntry,
} from "@/lib/premarket-catalyst-types";
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

function parseModelJsonCatalyst(raw: string): PremarketCatalystEntry {
  let t = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/m.exec(t);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end < start) {
    return normalizeCatalystFromApi({ summary: "No news", category: "UNKNOWN", guidanceTone: null });
  }
  try {
    const o = JSON.parse(t.slice(start, end + 1)) as {
      summary?: unknown;
      category?: unknown;
      guidanceTone?: unknown;
    };
    return normalizeCatalystFromApi(o);
  } catch {
    return normalizeCatalystFromApi({ summary: "No news", category: "UNKNOWN", guidanceTone: null });
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

  const results: Record<string, PremarketCatalystEntry> = {};

  const anthropic = apiKey ? new Anthropic({ apiKey }) : null;

  for (const symbol of symbols) {
    let items;
    try {
      items = await fetchStockNews(symbol, NEWS_FETCH_LIMIT);
    } catch {
      results[symbol] = normalizeCatalystFromApi({ summary: "No news" });
      continue;
    }

    const filtered = items.filter((n) =>
      isNewsInPremarketWindow(n.publishedUtc ?? n.publishedDate ?? "", todayYmd, priorYmd)
    );

    if (filtered.length === 0) {
      results[symbol] = normalizeCatalystFromApi({ summary: "No news" });
      continue;
    }

    if (!anthropic) {
      results[symbol] = normalizeCatalystFromApi({
        summary: filtered.length > 0 ? "Catalyst unavailable" : "No news",
        category: "UNKNOWN",
        guidanceTone: null,
      });
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

**Category (pick exactly one):**
EARNINGS — EPS/revenue beat or miss vs expectations
GUIDANCE — forward outlook raised or lowered
CONTRACT — new deal, government award, enterprise win
CLINICAL — FDA, trial data, drug pipeline
M_AND_A — acquisition, merger, buyout offer
PARTNERSHIP — alliance, JV, licensing
UPGRADE — analyst upgrade/initiation, PT raise
MANAGEMENT — CEO change, board, activist
UNKNOWN — only if none of the above fit

For GUIDANCE only: set guidanceTone to "raised" or "lowered" when inferable; otherwise null.

**Output rules:**
- Return ONLY valid JSON: {"summary":"...","category":"...","guidanceTone":null or "raised" or "lowered"}
- summary: 3–4 sentences, concise, professional.
- When citing a source, include a markdown link: [publisher or short title](full_url) using ONLY URLs from the articles above.
- If nothing is relevant: {"summary":"No news","category":"UNKNOWN","guidanceTone":null}
- No prose outside the JSON object.`;

    try {
      const msg = await anthropic.messages.create({
        model: SONNET_MODEL,
        max_tokens: 900,
        messages: [{ role: "user", content: userPrompt }],
      });
      const block = msg.content[0];
      const text = block && block.type === "text" ? block.text : "";
      const parsed = parseModelJsonCatalyst(text);
      results[symbol] = normalizeCatalystFromApi(parsed);
    } catch {
      results[symbol] = normalizeCatalystFromApi({ summary: "No news" });
    }
  }

  return NextResponse.json({
    results,
    window: { todayYmd, priorSessionYmd: priorYmd, timezone: "America/New_York" },
  });
}
