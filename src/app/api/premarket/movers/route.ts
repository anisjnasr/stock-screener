import { NextRequest, NextResponse } from "next/server";
import { fetchProfile, fetchStockSnapshotsForSymbolList, fetchTopMarketMovers } from "@/lib/massive";
import type { PremarketFilters, PremarketMoverRow } from "@/lib/premarket-types";
import {
  getCompanyName,
  getPremarketScanCandidates,
  getStockProfileDbMetrics,
  PREMARKET_SCAN_DEFAULT_MAX_SYMBOLS,
} from "@/lib/screener-db-native";

export const runtime = "nodejs";
export const maxDuration = 60;

function parsePositiveFloat(s: string | null, fallback: number): number {
  if (s == null || s === "") return fallback;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function passesFilters(row: PremarketMoverRow, f: PremarketFilters): boolean {
  if (row.lastPrice < f.minPrice) return false;
  if (row.gapPct < f.minGapPct) return false;
  if (row.pmVolume < f.minPmVolume) return false;
  if (row.avgVolume1m == null || row.avgVolume1m < f.minAvgVolume) return false;
  if (row.marketCap == null || row.marketCap < f.minMarketCap) return false;
  return true;
}

function buildRowFromSnapshot(
  r: import("@/lib/massive").TopMoverSnapshotRow
): PremarketMoverRow {
  const name = getCompanyName(r.ticker) ?? r.ticker;
  const { metrics } = getStockProfileDbMetrics(r.ticker);
  const marketCap = metrics?.marketCap ?? null;
  const avgFromDb =
    metrics?.avgVolume20d != null && Number.isFinite(metrics.avgVolume20d) && metrics.avgVolume20d > 0
      ? metrics.avgVolume20d
      : null;
  const avgVolume1m =
    r.avgVolume1m != null && r.avgVolume1m > 0 ? r.avgVolume1m : avgFromDb;
  let volRatioPct: number | null = null;
  if (avgVolume1m != null && avgVolume1m > 0 && Number.isFinite(r.pmVolume) && r.pmVolume >= 0) {
    volRatioPct = (r.pmVolume / avgVolume1m) * 100;
  }
  return {
    ticker: r.ticker,
    name,
    prevClose: r.prevClose,
    lastPrice: r.lastPrice,
    gapPct: r.gapPct,
    pmVolume: r.pmVolume,
    avgVolume1m,
    marketCap,
    volRatioPct,
  };
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

    const useMoversFallback = sp.get("source") === "movers";
    const envMax = Number(process.env.PREMARKET_SNAPSHOT_MAX_SYMBOLS);
    const defaultMax = Number.isFinite(envMax) && envMax > 0 ? envMax : PREMARKET_SCAN_DEFAULT_MAX_SYMBOLS;
    const maxSymbols = parsePositiveFloat(sp.get("maxSymbols"), defaultMax);

    let raw: import("@/lib/massive").TopMoverSnapshotRow[];
    let candidateCount = 0;
    let snapshotChunkCount = 0;
    let scanDate: string | null = null;
    let sourceUsed: "full-market" | "movers" = "full-market";

    if (useMoversFallback) {
      raw = await fetchTopMarketMovers(direction);
      sourceUsed = "movers";
    } else {
      const { symbols, date } = getPremarketScanCandidates({
        minMarketCap: filters.minMarketCap,
        minPrice: filters.minPrice,
        minAvgVolume: filters.minAvgVolume,
        maxSymbols,
      });
      scanDate = date;
      candidateCount = symbols.length;
      if (symbols.length === 0) {
        raw = [];
      } else {
        const { rows, chunkCount } = await fetchStockSnapshotsForSymbolList(symbols);
        snapshotChunkCount = chunkCount;
        raw = rows.filter((r) => r.gapPct > 0);
      }
    }

    const movers: PremarketMoverRow[] = raw.map((r) => buildRowFromSnapshot(r));

    movers.sort((a, b) => b.gapPct - a.gapPct);

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

    const eligibleNow = movers.filter((row) => passesFilters(row, filters));

    return NextResponse.json({
      movers,
      eligibleNow,
      filters,
      direction,
      fetchedAt: new Date().toISOString(),
      meta: {
        source: sourceUsed,
        candidateCount,
        snapshotTickerCount: raw.length,
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
