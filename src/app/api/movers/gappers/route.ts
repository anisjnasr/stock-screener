import { NextResponse, type NextRequest } from "next/server";
import { unstable_cache } from "next/cache";
import { getTickersWithEarningsInLast24Hours } from "@/lib/premarket/earnings-recent";
import { loadGappersScanOnly, normalizeGappersScanBody } from "@/lib/premarket/gappers-ingest";
import type { GappersResponse } from "@/types/gappers";

export const dynamic = "force-dynamic";

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

    const out: GappersResponse = {
      ok: true,
      source: base.source,
      rows,
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
