import { NextRequest, NextResponse } from "next/server";
import { existsSync } from "fs";
import Database from "better-sqlite3";
import { getScreenerDbPath } from "@/lib/data-path";
import { getLatestCompletedTradingDate } from "@/lib/screener-db-native";
import { INDUSTRY_ETF_UNIVERSE } from "@/lib/industry-etf-universe";
import type { MatrixPerfMap, MatrixRow } from "../matrix-shared";

const MAX_CONSTITUENTS = 1500;

export async function GET(request: NextRequest) {
  try {
    const etfTicker = String(request.nextUrl.searchParams.get("etfTicker") ?? "").trim().toUpperCase();
    if (!etfTicker) {
      return NextResponse.json({ error: "Missing etfTicker." }, { status: 400 });
    }

    const row = INDUSTRY_ETF_UNIVERSE.find((r) => r.ticker.toUpperCase() === etfTicker);
    if (!row) {
      return NextResponse.json({ error: "Unknown industry ETF ticker." }, { status: 400 });
    }

    const asOfDate = getLatestCompletedTradingDate();
    if (!asOfDate) {
      return NextResponse.json({ error: "No trading date." }, { status: 503 });
    }

    const dbPath = getScreenerDbPath();
    if (!existsSync(dbPath)) {
      return NextResponse.json({ error: "Database not found." }, { status: 503 });
    }

    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const cacheTableExists = Number(
        db
          .prepare(
            "SELECT COUNT(1) AS c FROM sqlite_master WHERE type = 'table' AND name = 'industry_constituents_perf_cache'"
          )
          .get()?.c ?? 0
      ) > 0;
      if (!cacheTableExists) {
        return NextResponse.json(
          {
            error:
              "industry_constituents_perf_cache missing. Run daily refresh to precompute industry ETF constituents.",
          },
          { status: 503 }
        );
      }

      const cachedRows = db
        .prepare(
          `
          SELECT
            symbol,
            name,
            perf_day,
            perf_week,
            perf_month,
            perf_quarter,
            perf_half_year,
            perf_year,
            perf_ytd
          FROM industry_constituents_perf_cache
          WHERE as_of_date = ? AND etf_ticker = ?
          ORDER BY symbol
          LIMIT ?
          `
        )
        .all(asOfDate, etfTicker, MAX_CONSTITUENTS) as Array<{
        symbol: string;
        name: string;
        perf_day: number | null;
        perf_week: number | null;
        perf_month: number | null;
        perf_quarter: number | null;
        perf_half_year: number | null;
        perf_year: number | null;
        perf_ytd: number | null;
      }>;

      const outRows: MatrixRow[] = cachedRows.map((r) => ({
        id: `c-${String(r.symbol).toUpperCase()}`,
        name: r.name,
        ticker: String(r.symbol).toUpperCase(),
        drillKind: row.drillKind,
        drillValue: row.drillValue,
        perf: {
          day: r.perf_day,
          week: r.perf_week,
          month: r.perf_month,
          quarter: r.perf_quarter,
          half_year: r.perf_half_year,
          year: r.perf_year,
          ytd: r.perf_ytd,
        } as MatrixPerfMap,
      }));

      return NextResponse.json(
        { rows: outRows, date: asOfDate, etfTicker },
        { headers: { "Cache-Control": "private, max-age=120" } }
      );
    } finally {
      db.close();
    }

  } catch (e) {
    const message = e instanceof Error ? e.message : "constituents-matrix failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
