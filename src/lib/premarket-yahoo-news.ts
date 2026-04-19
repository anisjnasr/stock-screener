/**
 * Yahoo Finance news for premarket SIP catalyst (yahoo-finance2 search).
 */

import { isNewsInPremarketWindow } from "@/lib/premarket-news-window";

export type YahooNewsArticleForCatalyst = {
  title: string;
  publisher: string;
  link: string;
  /** ISO timestamp used for ET calendar filtering */
  publishedIso: string;
};

const DEFAULT_NEWS_COUNT = 45;

/**
 * Fetches Yahoo `search` news for `symbol` and keeps items whose publish time
 * falls on `todayYmd` or `priorSessionYmd` in America/New_York.
 */
export async function fetchYahooSearchNewsInWindow(
  symbol: string,
  todayYmd: string,
  priorSessionYmd: string,
  newsCount = DEFAULT_NEWS_COUNT
): Promise<YahooNewsArticleForCatalyst[]> {
  const YahooFinance = (await import("yahoo-finance2")).default as unknown as new (opts?: {
    suppressNotices?: string[];
  }) => {
    search: (
      query: string,
      opts: { newsCount?: number; quotesCount?: number; lang?: string; region?: string }
    ) => Promise<{
      news?: Array<{
        title?: string;
        publisher?: string;
        link?: string;
        providerPublishTime?: Date;
      }>;
    }>;
  };

  const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

  let rawNews: Array<{
    title?: string;
    publisher?: string;
    link?: string;
    providerPublishTime?: Date;
  }> = [];
  try {
    const res = await yf.search(symbol, {
      newsCount,
      quotesCount: 0,
      lang: "en-US",
      region: "US",
    });
    rawNews = Array.isArray(res.news) ? res.news : [];
  } catch {
    return [];
  }

  const out: YahooNewsArticleForCatalyst[] = [];
  for (const n of rawNews) {
    const title = String(n.title ?? "").replace(/\s+/g, " ").trim();
    const link = String(n.link ?? "").trim();
    if (!title || !/^https?:\/\//i.test(link)) continue;
    const pt = n.providerPublishTime;
    if (!(pt instanceof Date) || Number.isNaN(pt.getTime())) continue;
    const publishedIso = pt.toISOString();
    if (!isNewsInPremarketWindow(publishedIso, todayYmd, priorSessionYmd)) continue;
    out.push({
      title,
      publisher: String(n.publisher ?? "").trim() || "Yahoo",
      link,
      publishedIso,
    });
    if (out.length >= 30) break;
  }
  return out;
}

/** Human-readable block for the catalyst model prompt. */
export function formatYahooNewsForPrompt(articles: YahooNewsArticleForCatalyst[]): string {
  if (articles.length === 0) {
    return "(No Yahoo Finance headlines in the allowed ET dates for this symbol.)";
  }
  return articles
    .map((a, i) => {
      const ymd = a.publishedIso.slice(0, 10);
      return `[Y${i + 1}] ${a.title} (${a.publisher}) — ${ymd}\n    URL: ${a.link}`;
    })
    .join("\n\n");
}
