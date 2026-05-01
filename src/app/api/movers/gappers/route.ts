import { NextResponse, type NextRequest } from "next/server";
import { unstable_cache } from "next/cache";
import { getTickersWithEarningsInLast24Hours } from "@/lib/premarket/earnings-recent";
import { loadGappersScanOnly, normalizeGappersScanBody } from "@/lib/premarket/gappers-ingest";
import { fetchPythonTickerNews, isPythonServiceConfigured } from "@/lib/python-service";
import type { GappersResponse } from "@/types/gappers";

export const dynamic = "force-dynamic";

function normalizeIncludeNews(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return true;
  const v = (raw as Record<string, unknown>).includeNews;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (t === "false" || t === "0" || t === "off" || t === "no") return false;
    if (t === "true" || t === "1" || t === "on" || t === "yes") return true;
  }
  return true;
}

/**
 * Pre-market gappers: TradingView `america/scan` only (no fallback if TV fails).
 * POST JSON body — see `GappersRequestBody` in `@/types/gappers`.
 * Scan results cached 30s; earnings flags (Phase 11C) merged on every request.
 */
export async function POST(request: NextRequest) {
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const scan = normalizeGappersScanBody(body);
  const includeNews = normalizeIncludeNews(body);
  const cacheKey = JSON.stringify(scan);

  try {
    const base = await unstable_cache(
      async () => loadGappersScanOnly(scan),
      ["premarket-gappers", cacheKey],
      { revalidate: 30 }
    )();

    const earnings = await getTickersWithEarningsInLast24Hours();
    const rows = base.rows.map((r) => ({
      ...r,
      earningsRecent24h: earnings.has(r.ticker),
    }));
    const tickers = rows.map((r) => r.ticker);
    let news: GappersResponse["news"] = null;
    let newsError: string | null = null;
    if (includeNews && tickers.length > 0 && isPythonServiceConfigured()) {
      try {
        const pack = await fetchPythonTickerNews({
          tickers,
          hoursBack: 24,
          signal: request.signal,
        });
        news = pack.data;
      } catch (e) {
        newsError = e instanceof Error ? e.message : "Unknown error";
      }
    }

    const out: GappersResponse = {
      ok: true,
      source: base.source,
      rows,
      newsSearched: includeNews,
      pythonConfigured: isPythonServiceConfigured(),
      news,
      newsError,
    };
    return NextResponse.json(out, {
      headers: {
        "Cache-Control": "private, s-maxage=30, stale-while-revalidate=60",
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
}
