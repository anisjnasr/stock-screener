import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import {
  normalizeCatalystFromApi,
  type PremarketCatalystEntry,
} from "@/lib/premarket-catalyst-types";
import { priorTradingSessionYmdEt, todayYmdEt } from "@/lib/premarket-news-window";
import {
  fetchYahooSearchNewsInWindow,
  formatYahooNewsForPrompt,
  type YahooNewsArticleForCatalyst,
} from "@/lib/premarket-yahoo-news";

export const runtime = "nodejs";

const SONNET_MODEL = "claude-sonnet-4-20250514";
const MAX_SYMBOLS = 12;
const WEB_SEARCH_MAX_USES = 12;

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

function anthropicAssistantText(msg: Anthropic.Messages.Message): string {
  const parts: string[] = [];
  for (const block of msg.content) {
    if (block.type === "text") parts.push(block.text);
  }
  return parts.join("\n");
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
      sourcesMarkdown?: unknown;
    };
    return normalizeCatalystFromApi(o);
  } catch {
    return normalizeCatalystFromApi({ summary: "No news", category: "UNKNOWN", guidanceTone: null });
  }
}

function buildUserPrompt(symbol: string, todayYmd: string, priorYmd: string, yahooBlock: string): string {
  return `Ticker: ${symbol}

You are helping a trader understand why the stock may be gapping up in pre-market.

**Allowed news dates (America/New_York calendar only):** ${priorYmd} and ${todayYmd}.
Treat any source outside those two calendar dates as out of scope.

**Step 1 — Yahoo Finance (in-window headlines, already filtered to those dates):**
${yahooBlock}

**Step 2 — Web search:** Use the \`web_search\` tool to find additional reporting that plausibly explains the gap-up for ${symbol}, still limited to publications dated ${priorYmd} or ${todayYmd} in the US/Eastern sense when the publication date is clear. Prefer **concrete, company-specific** items: earnings results or expectations, guidance changes, signed deals, partnerships, M&A, FDA/clinical, analyst upgrades, management changes. If those are not available, you may cite **broader** pieces (newsletters, sector/market roundups mentioning multiple names) but clearly treat them as weaker, indirect evidence.

**Sources / links:** Every factual claim should lean on real URLs. In \`sourcesMarkdown\`, list the **most important** articles as markdown bullet lines using only verified \`https://\` links (from Yahoo block above and/or web_search). Format each line exactly as: \`- [short title or publisher](https://...)\`

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
- Return ONLY valid JSON (one object, no markdown outside it):
  {"summary":"...","category":"...","guidanceTone":null or "raised" or "lowered","sourcesMarkdown":"..."}
- summary: 3–4 sentences, concise, professional. You may include inline markdown links in the summary when citing a specific piece.
- sourcesMarkdown: markdown bullet list (\`- [label](url)\` per line). Use empty string "" only if there are truly no usable sources in the allowed window.
- If nothing explains the move: {"summary":"No news","category":"UNKNOWN","guidanceTone":null,"sourcesMarkdown":""}
- No prose outside the JSON object.`;
}

async function runCatalystModel(
  anthropic: Anthropic,
  symbol: string,
  todayYmd: string,
  priorYmd: string,
  yahooBlock: string,
  withWebSearch: boolean
): Promise<PremarketCatalystEntry> {
  const userPrompt = buildUserPrompt(symbol, todayYmd, priorYmd, yahooBlock);
  const base = {
    model: SONNET_MODEL,
    max_tokens: 2200,
    messages: [{ role: "user" as const, content: userPrompt }],
  };

  if (withWebSearch) {
    try {
      const msg = await anthropic.messages.create({
        ...base,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: WEB_SEARCH_MAX_USES }],
        tool_choice: { type: "auto" },
      });
      return parseModelJsonCatalyst(anthropicAssistantText(msg));
    } catch {
      // fall through to non-tool call below
    }
  }

  const msg = await anthropic.messages.create(base);
  return parseModelJsonCatalyst(anthropicAssistantText(msg));
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
    let yahooArticles: YahooNewsArticleForCatalyst[] = [];
    try {
      yahooArticles = await fetchYahooSearchNewsInWindow(symbol, todayYmd, priorYmd);
    } catch {
      yahooArticles = [];
    }

    const yahooBlock = formatYahooNewsForPrompt(yahooArticles);

    if (!anthropic) {
      results[symbol] = normalizeCatalystFromApi({
        summary: yahooArticles.length > 0 ? "Catalyst unavailable" : "No news",
        category: "UNKNOWN",
        guidanceTone: null,
      });
      continue;
    }

    try {
      const entry = await runCatalystModel(anthropic, symbol, todayYmd, priorYmd, yahooBlock, true);
      results[symbol] = normalizeCatalystFromApi(entry);
    } catch {
      results[symbol] = normalizeCatalystFromApi({ summary: "No news", category: "UNKNOWN", guidanceTone: null });
    }
  }

  return NextResponse.json({
    results,
    window: { todayYmd, priorSessionYmd: priorYmd, timezone: "America/New_York" },
  });
}
