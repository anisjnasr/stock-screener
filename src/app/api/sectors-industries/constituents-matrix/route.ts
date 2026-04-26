import { NextRequest, NextResponse } from "next/server";
import { existsSync, readFileSync } from "fs";
import Database from "better-sqlite3";
import { getScreenerDbPath, resolveDataPath } from "@/lib/data-path";
import {
  getLatestCompletedTradingDate,
  getTickerPerformance,
  type PerformanceTimeframe,
} from "@/lib/screener-db-native";
import { INDUSTRY_ETF_UNIVERSE } from "@/lib/industry-etf-universe";
import { THEMATIC_ETFS } from "@/lib/thematic-etfs";
import { MATRIX_PERF_TF, type MatrixPerfMap, type MatrixRow } from "../matrix-shared";

const THEMATIC_DATA_PATH = resolveDataPath("thematic-etf-constituents.json");
const MAX_CONSTITUENTS = 1500;

function emptyPerf(): MatrixPerfMap {
  const o = {} as MatrixPerfMap;
  for (const tf of MATRIX_PERF_TF) o[tf] = null;
  return o;
}

function normalizeSymbols(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((s) => String(s ?? "").trim().toUpperCase())
    .filter((s) => /^[A-Z][A-Z0-9.\-]*$/.test(s));
}

function loadThematicConstituents(etfTicker: string): string[] {
  if (!existsSync(THEMATIC_DATA_PATH)) return [];
  try {
    const raw = readFileSync(THEMATIC_DATA_PATH, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return normalizeSymbols(parsed[etfTicker.toUpperCase()]);
  } catch {
    return [];
  }
}

function industrySymbols(db: InstanceType<typeof Database>, industryName: string, asOf: string): string[] {
  const rows = db
    .prepare(
      `
    SELECT c.symbol AS symbol
    FROM companies c
    WHERE c.industry = ?
      AND IFNULL(c.is_etf, 0) = 0
      AND EXISTS (SELECT 1 FROM daily_bars d WHERE d.symbol = c.symbol AND d.date = ?)
    ORDER BY c.symbol
    LIMIT ?
  `
    )
    .all(industryName, asOf, MAX_CONSTITUENTS) as Array<{ symbol: string }>;
  return rows.map((r) => String(r.symbol).toUpperCase());
}

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
    let symbols: string[] = [];
    try {
      if (row.drillKind === "industry") {
        symbols = industrySymbols(db, row.name, asOfDate);
      } else {
        const validThematic = new Set(THEMATIC_ETFS.map((t) => t.ticker.toUpperCase()));
        if (!validThematic.has(etfTicker)) {
          return NextResponse.json({ rows: [] as MatrixRow[], date: asOfDate, etfTicker });
        }
        symbols = loadThematicConstituents(etfTicker).slice(0, MAX_CONSTITUENTS);
      }

      if (symbols.length === 0) {
        return NextResponse.json({ rows: [] as MatrixRow[], date: asOfDate, etfTicker });
      }

      const ph = symbols.map(() => "?").join(",");
      const coRows = db.prepare(`SELECT symbol, name FROM companies WHERE symbol IN (${ph})`).all(...symbols) as Array<{
        symbol: string;
        name: string | null;
      }>;
      const nameBySymbol = new Map<string, string>();
      for (const c of coRows) {
        nameBySymbol.set(String(c.symbol).toUpperCase(), c.name != null ? String(c.name) : String(c.symbol));
      }

      const perfBySymbol = new Map<string, MatrixPerfMap>();
      for (const sym of symbols) {
        perfBySymbol.set(sym, emptyPerf());
      }

      for (const tf of MATRIX_PERF_TF) {
        const tfP = tf as PerformanceTimeframe;
        const { rows } = getTickerPerformance(symbols, tfP, asOfDate);
        const bySym = new Map(rows.map((r) => [String(r.symbol).toUpperCase(), r.change_pct]));
        for (const sym of symbols) {
          const perf = perfBySymbol.get(sym);
          if (perf) perf[tf] = bySym.get(sym) ?? null;
        }
      }

      const outRows: MatrixRow[] = symbols.map((sym) => ({
        id: `c-${sym}`,
        name: nameBySymbol.get(sym) ?? sym,
        ticker: sym,
        drillKind: row.drillKind,
        drillValue: row.drillValue,
        perf: perfBySymbol.get(sym) ?? emptyPerf(),
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
