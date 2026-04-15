import { NextRequest, NextResponse } from "next/server";
import { fetchProfile, fetchTopMarketMovers } from "@/lib/massive";
import type { PremarketFilters, PremarketMoverRow } from "@/lib/premarket-types";
import { getCompanyName, getStockProfileDbMetrics } from "@/lib/screener-db-native";

export const runtime = "nodejs";

function parsePositiveFloat(s: string | null, fallback: number): number {
  if (s == null || s === "") return fallback;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function passesFilters(row: PremarketMoverRow, f: PremarketFilters): boolean {
  if (row.lastPrice < f.minPrice) return false;
  if (row.pmVolume < f.minPmVolume) return false;
  if (row.gapPct < f.minGapPct) return false;
  if (row.marketCap == null || row.marketCap < f.minMarketCap) return false;
  return true;
}

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const direction = sp.get("direction") === "losers" ? "losers" : "gainers";
    const filters: PremarketFilters = {
      minPrice: parsePositiveFloat(sp.get("minPrice"), 5),
      minPmVolume: parsePositiveFloat(sp.get("minPmVolume"), 50_000),
      minGapPct: parsePositiveFloat(sp.get("minGapPct"), 3),
      minMarketCap: parsePositiveFloat(sp.get("minMarketCap"), 500_000_000),
    };

    const raw = await fetchTopMarketMovers(direction);
    const movers: PremarketMoverRow[] = raw.map((r) => {
      const name = getCompanyName(r.ticker) ?? r.ticker;
      const { metrics } = getStockProfileDbMetrics(r.ticker);
      const marketCap = metrics?.marketCap ?? null;
      const avgVolume1m = metrics?.avgVolume20d ?? r.avgVolume1m;
      const volRatioPct =
        avgVolume1m != null && avgVolume1m > 0 ? (r.pmVolume / avgVolume1m) * 100 : null;
      return {
        ticker: r.ticker,
        name,
        prevClose: r.prevClose,
        lastPrice: r.lastPrice,
        gapPct: r.gapPct,
        pmVolume: r.pmVolume,
        avgVolume1m: avgVolume1m != null && avgVolume1m > 0 ? avgVolume1m : null,
        marketCap,
        volRatioPct,
      };
    });

    movers.sort((a, b) => b.gapPct - a.gapPct);

    for (let i = 0; i < movers.length; i++) {
      const row = movers[i];
      if (row.marketCap != null && row.avgVolume1m != null) continue;
      try {
        const p = await fetchProfile(row.ticker);
        const marketCap =
          row.marketCap ??
          (typeof p?.mktCap === "number" && Number.isFinite(p.mktCap) && p.mktCap > 0 ? p.mktCap : null);
        const avgVolume1m =
          row.avgVolume1m ??
          (typeof p?.volAvg === "number" && Number.isFinite(p.volAvg) && p.volAvg > 0 ? p.volAvg : null);
        const volRatioPct =
          avgVolume1m != null && avgVolume1m > 0 ? (row.pmVolume / avgVolume1m) * 100 : null;
        const name =
          row.name !== row.ticker
            ? row.name
            : p?.companyName && String(p.companyName).trim()
              ? String(p.companyName).trim()
              : row.ticker;
        movers[i] = { ...row, name, marketCap, avgVolume1m, volRatioPct };
      } catch {
        /* keep row as-is */
      }
    }

    const eligibleNow = movers.filter((row) => passesFilters(row, filters));

    return NextResponse.json({
      movers,
      eligibleNow,
      filters,
      direction,
      fetchedAt: new Date().toISOString(),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Premarket movers error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
