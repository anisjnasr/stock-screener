import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import type { ScreenerFilters } from "@/lib/screener-db";
import { runNinoScript } from "@/lib/nino-script";

const INDEX_IDS = ["nasdaq100", "sp500", "russell2000"] as const;

async function getSymbolsForUniverse(universe: string): Promise<string[]> {
  if (universe === "all") {
    try {
      const { getScreenerSnapshot: getNative } = await import("@/lib/screener-db-native");
      const { rows } = getNative({ limit: 20000, filters: {} });
      return rows.map((r) => r.symbol);
    } catch {
      const { getScreenerSnapshot: getAsync } = await import("@/lib/screener-db");
      const { rows } = await getAsync({ limit: 20000, filters: {} });
      return rows.map((r) => r.symbol);
    }
  }
  const id = universe.toLowerCase();
  if (INDEX_IDS.includes(id as (typeof INDEX_IDS)[number])) {
    const path = join(process.cwd(), "data", `${id}.json`);
    if (existsSync(path)) {
      const raw = readFileSync(path, "utf8");
      return JSON.parse(raw) as string[];
    }
  }
  return [];
}

type ScreenerSnapshotOptions = {
  date?: string;
  symbols?: string[];
  limit?: number;
  offset?: number;
  filters?: import("@/lib/screener-db").ScreenerFilters;
};

/** Use native SQLite (better-sqlite3) so large screener.db can be opened without loading into memory. Falls back to sql.js if native fails. */
async function getScreenerSnapshot(
  options: ScreenerSnapshotOptions
): Promise<{ rows: import("@/lib/screener-db").ScreenerRow[]; date: string | null }> {
  try {
    const { getScreenerSnapshot: getNative } = await import("@/lib/screener-db-native");
    return getNative(options);
  } catch {
    const { getScreenerSnapshot: getAsync } = await import("@/lib/screener-db");
    return getAsync(options);
  }
}

async function getScreenerCount(
  options: ScreenerSnapshotOptions
): Promise<{ count: number; date: string | null }> {
  try {
    const { getScreenerCount: getNative } = await import("@/lib/screener-db-native");
    return getNative(options);
  } catch {
    const { getScreenerCount: getAsync } = await import("@/lib/screener-db");
    return getAsync(options);
  }
}

async function getLatestScreenerDate(): Promise<string | null> {
  try {
    const { getLatestScreenerDate: getNative } = await import("@/lib/screener-db-native");
    return getNative();
  } catch {
    const { getLatestScreenerDate: getAsync } = await import("@/lib/screener-db");
    return getAsync();
  }
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const date = params.get("date") ?? undefined;
    const symbolsParam = params.get("symbols");
    const symbols =
      symbolsParam != null
        ? symbolsParam
            .split(",")
            .map((s) => s.trim().toUpperCase())
            .filter(Boolean)
        : undefined;
    const limit = params.get("limit");
    const offset = params.get("offset");
    const filtersParam = params.get("filters");
    let filters: ScreenerFilters | undefined;
    if (filtersParam) {
      try {
        filters = JSON.parse(filtersParam) as ScreenerFilters;
      } catch {
        filters = undefined;
      }
    }

    if (params.has("latestDateOnly")) {
      const latest = await getLatestScreenerDate();
      return NextResponse.json({ date: latest });
    }

    if (params.has("countOnly")) {
      const { count, date: snapshotDate } = await getScreenerCount({
        date: date ?? undefined,
        symbols,
        filters,
      });
      return NextResponse.json({ count, date: snapshotDate });
    }

    const scriptBody = params.get("scriptBody") ?? params.get("script") ?? "";
    if (scriptBody.trim()) {
      const asOfDate = date ?? (await getLatestScreenerDate());
      if (!asOfDate) {
        return NextResponse.json({ date: null, rows: [], error: "No screener date available" }, { status: 200 });
      }
      let scriptSymbols = symbols;
      if (!scriptSymbols || scriptSymbols.length === 0) {
        const universe = params.get("universe") ?? "all";
        scriptSymbols = await getSymbolsForUniverse(universe);
      }
      if (scriptSymbols.length === 0) {
        return NextResponse.json({ date: asOfDate, rows: [] }, { status: 200 });
      }
      const { passingSymbols, scriptColumns, scriptValues, error: scriptError } = await runNinoScript(
        scriptBody.trim(),
        scriptSymbols,
        asOfDate
      );
      if (scriptError) {
        return NextResponse.json({ date: asOfDate, rows: [], scriptColumns: [], error: scriptError }, { status: 200 });
      }
      if (passingSymbols.length === 0) {
        return NextResponse.json({ date: asOfDate, rows: [], scriptColumns: scriptColumns }, { status: 200 });
      }
      const { rows, date: snapshotDate } = await getScreenerSnapshot({
        date: asOfDate,
        symbols: passingSymbols,
        limit: limit != null ? parseInt(limit, 10) : undefined,
        offset: offset != null ? parseInt(offset, 10) : undefined,
        filters: {},
      });
      const scriptColList = scriptColumns;
      const merged = rows.map((r) => {
        const sym = (r as { symbol?: string }).symbol;
        const extra = sym && scriptValues[sym] ? scriptValues[sym] : {};
        return { ...r, ...extra };
      });
      return NextResponse.json({ date: snapshotDate, rows: merged, scriptColumns: scriptColList });
    }

    const { rows, date: snapshotDate } = await getScreenerSnapshot({
      date,
      symbols,
      limit: limit != null ? parseInt(limit, 10) : undefined,
      offset: offset != null ? parseInt(offset, 10) : undefined,
      filters,
    });

    return NextResponse.json({
      date: snapshotDate,
      rows,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Screener error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
