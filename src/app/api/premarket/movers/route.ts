import { NextRequest, NextResponse } from "next/server";
import { fetchProfile, fetchFullMarketSnapshotRaw, fetchTopMarketMovers } from "@/lib/massive";
import type { PremarketFilters, PremarketMoverRow } from "@/lib/premarket-types";
import { passesPremarketFilters } from "@/lib/premarket-types";
import {
  buildPremarketMoversFromFullSnapshot,
  premarketMoverFromTopSnapshotRow,
} from "@/lib/premarket/build-movers-from-snapshot";
import { getPremarketScreenerJoinMap, PREMARKET_SCAN_DEFAULT_MAX_SYMBOLS } from "@/lib/screener-db-native";

export const runtime = "nodejs";
export const maxDuration = 60;

function parsePositiveFloat(s: string | null, fallback: number): number {
  if (s == null || s === "") return fallback;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

async function enrichMoversWithProfile(movers: PremarketMoverRow[]): Promise<void> {
  for (let i = 0; i < movers.length; i++) {
    const row = movers[i];
    if (row.marketCap != null && row.name !== row.ticker) continue;
    try {
      const p = await fetchProfile(row.ticker);
      const marketCap =
        row.marketCap ??
        (typeof p?.mktCap === "number" && Number.isFinite(p.mktCap) && p.mktCap > 0 ? p.mktCap : null);
      const name =
        row.name !== row.ticker
          ? row.name
          : p?.companyName && String(p.companyName).trim()
            ? String(p.companyName).trim()
            : row.ticker;
      movers[i] = { ...row, name, marketCap };
    } catch {
      /* keep row as-is */
    }
  }
}

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const direction = sp.get("direction") === "losers" ? "losers" : "gainers";
    const filters: PremarketFilters = {
      minPrice: parsePositiveFloat(sp.get("minPrice"), 5),
      minGapPct: parsePositiveFloat(sp.get("minGapPct"), 3),
      minPmVolume: parsePositiveFloat(sp.get("minPmVolume"), 50_000),
      minAvgVolume: parsePositiveFloat(sp.get("minAvgVolume"), 500_000),
      minMarketCap: parsePositiveFloat(sp.get("minMarketCap"), 500_000_000),
    };

    const useMoversOnly = sp.get("source") === "movers";
    const envMax = Number(process.env.PREMARKET_SNAPSHOT_MAX_SYMBOLS);
    const defaultMax = Number.isFinite(envMax) && envMax > 0 ? envMax : PREMARKET_SCAN_DEFAULT_MAX_SYMBOLS;
    const maxSymbols = parsePositiveFloat(sp.get("maxSymbols"), defaultMax);

    let movers: PremarketMoverRow[];
    let sourceUsed: "full-market-snapshot" | "movers" | "movers-fallback";
    let candidateCount = 0;
    let snapshotChunkCount = 0;
    let scanDate: string | null = null;
    let snapshotTickerCount = 0;

    if (useMoversOnly) {
      const raw = await fetchTopMarketMovers(direction);
      movers = raw.map(premarketMoverFromTopSnapshotRow);
      if (direction === "gainers") {
        movers.sort((a, b) => b.gapPct - a.gapPct);
      } else {
        movers.sort((a, b) => a.gapPct - b.gapPct);
      }
      await enrichMoversWithProfile(movers);
      sourceUsed = "movers";
      snapshotTickerCount = raw.length;
    } else {
      const { byTicker, date } = getPremarketScreenerJoinMap();
      scanDate = date;
      candidateCount = byTicker.size;

      if (byTicker.size === 0) {
        try {
          const raw = await fetchTopMarketMovers(direction);
          movers = raw.map(premarketMoverFromTopSnapshotRow);
          if (direction === "gainers") {
            movers.sort((a, b) => b.gapPct - a.gapPct);
          } else {
            movers.sort((a, b) => a.gapPct - b.gapPct);
          }
          await enrichMoversWithProfile(movers);
          sourceUsed = "movers-fallback";
          snapshotTickerCount = raw.length;
        } catch {
          movers = [];
          sourceUsed = "movers-fallback";
        }
      } else {
        const { tickers: rawTickers } = await fetchFullMarketSnapshotRaw();
        snapshotTickerCount = rawTickers.length;
        movers = buildPremarketMoversFromFullSnapshot(rawTickers, byTicker, { direction });
        sourceUsed = "full-market-snapshot";
      }
    }

    const eligibleNow = movers.filter((row) => passesPremarketFilters(row, filters));

    return NextResponse.json({
      movers,
      eligibleNow,
      filters,
      direction,
      fetchedAt: new Date().toISOString(),
      meta: {
        source: sourceUsed,
        candidateCount,
        snapshotTickerCount,
        snapshotChunkCount,
        scanDate,
        maxSymbols,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Premarket movers error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
