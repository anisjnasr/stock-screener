/**
 * Company news for the DD panel (spec §5.6).
 * Yahoo Finance primary → Polygon fallback; 24h window (extended to prior Friday on
 * a Monday); pattern-exclude roundups → cheap Haiku relevance pass → keep top 3.
 */

import Anthropic from "@anthropic-ai/sdk";
import { fetchDDPolygonNews } from "./polygon";
import type { DDNewsItem } from "./types";

const NEWS_MODEL = process.env.DD_NEWS_MODEL?.trim() || "claude-haiku-4-5";
const ET = "America/New_York";

/** ms to add to a UTC timestamp to reach ET wall clock (negative; -4h EDT / -5h EST). */
function etOffsetMs(at: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: ET,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value])
  );
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return asUTC - at.getTime();
}

function etYmd(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ET, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

function etWeekday(at: Date): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: ET, weekday: "long" }).format(at);
}

function etMidnightEpochMs(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0);
  return guess - etOffsetMs(new Date(guess));
}

function addDaysYmd(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/** Window start epoch ms: 24h back, or prior Friday 00:00 ET when today (ET) is Monday. */
export function newsWindowStartMs(now = new Date()): number {
  const dayMs = 86_400_000;
  const def = now.getTime() - dayMs;
  if (etWeekday(now) === "Monday") {
    const priorFriday = addDaysYmd(etYmd(now), -3);
    return Math.min(def, etMidnightEpochMs(priorFriday));
  }
  return def;
}

const ROUNDUP_PATTERNS: RegExp[] = [
  /stocks?\s+to\s+(buy|watch)/i,
  /best\s+stocks?/i,
  /top\s+\d+/i,
  /better\s+buy/i,
  /\bvs\.?\b/i,
  /\b(motley fool|zacks)\b/i,
  /\d+\s+(stocks|reasons|things)/i,
  /market\s+(recap|wrap|today)/i,
  /(why|is)\s+.+\s+a\s+(buy|sell)/i,
];

export function isRoundupTitle(title: string): boolean {
  return ROUNDUP_PATTERNS.some((re) => re.test(title));
}

type YahooNewsRaw = { title?: string; link?: string; publisher?: string; providerPublishTime?: number | Date };

async function fetchYahooNews(ticker: string): Promise<DDNewsItem[]> {
  try {
    const YahooFinance = (await import("yahoo-finance2")).default as unknown as {
      search: (q: string, opts?: Record<string, unknown>) => Promise<{ news?: YahooNewsRaw[] }>;
    };
    const res = await YahooFinance.search(ticker, { newsCount: 20, quotesCount: 0 });
    const news = res?.news ?? [];
    return news
      .map((n): DDNewsItem | null => {
        if (!n.title || !n.link) return null;
        const ts =
          n.providerPublishTime instanceof Date
            ? n.providerPublishTime.getTime()
            : typeof n.providerPublishTime === "number"
              ? n.providerPublishTime * 1000
              : NaN;
        if (!Number.isFinite(ts)) return null;
        return {
          title: String(n.title),
          url: String(n.link),
          source: n.publisher ?? "Yahoo Finance",
          published_utc: new Date(ts).toISOString(),
          provider: "yahoo",
        };
      })
      .filter((n): n is DDNewsItem => n !== null);
  } catch {
    return [];
  }
}

/** Haiku pass: keep only genuine company-specific catalysts. Returns kept indices. */
async function classifyRelevant(ticker: string, titles: string[]): Promise<number[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || titles.length === 0) return titles.map((_, i) => i);
  try {
    const anthropic = new Anthropic({ apiKey });
    const numbered = titles.map((t, i) => `${i}: ${t}`).join("\n");
    const msg = await anthropic.messages.create({
      model: NEWS_MODEL,
      max_tokens: 200,
      temperature: 0,
      system:
        "You filter stock-news headlines for a small-cap trader. Keep ONLY genuine company-specific events/catalysts " +
        "(offering, earnings, contract/agreement, FDA/clinical/data readout, M&A, guidance, Nasdaq/listing notice, " +
        "management change, etc.). Drop generic roundups, market recaps, and articles that merely mention the ticker. " +
        'Reply with ONLY a JSON array of the indices to KEEP, e.g. [0,2]. No prose.',
      messages: [{ role: "user", content: `Ticker ${ticker}. Headlines:\n${numbered}` }],
    });
    const text = msg.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    const m = text.match(/\[[\d,\s]*\]/);
    if (!m) return titles.map((_, i) => i);
    const arr = JSON.parse(m[0]) as number[];
    return arr.filter((i) => Number.isInteger(i) && i >= 0 && i < titles.length);
  } catch {
    // On classification failure, fall back to the pattern-filtered set unchanged.
    return titles.map((_, i) => i);
  }
}

/** Full pipeline: returns up to 3 company-specific items, newest first. */
export async function fetchDDNews(ticker: string, signal?: AbortSignal, now = new Date()): Promise<DDNewsItem[]> {
  const windowStart = newsWindowStartMs(now);

  let items = await fetchYahooNews(ticker);
  if (items.length === 0) items = await fetchDDPolygonNews(ticker, signal);

  const inWindow = items
    .filter((n) => {
      const ms = Date.parse(n.published_utc);
      return Number.isFinite(ms) && ms >= windowStart;
    })
    .filter((n) => !isRoundupTitle(n.title))
    .sort((a, b) => b.published_utc.localeCompare(a.published_utc));

  if (inWindow.length === 0) return [];

  const keepIdx = await classifyRelevant(ticker, inWindow.map((n) => n.title));
  const keepSet = new Set(keepIdx);
  const kept = inWindow.filter((_, i) => keepSet.has(i));
  return kept.slice(0, 3);
}
