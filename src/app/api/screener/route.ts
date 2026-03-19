import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import {
  getScreenerSnapshot,
  getScreenerCount,
  getLatestScreenerDate,
  type ScreenerFilters,
} from "@/lib/screener-db-native";
import { runNinoScript } from "@/lib/nino-script";
import { recordPerf } from "@/lib/perf-monitor";

const INDEX_IDS = ["nasdaq100", "sp500", "russell2000"] as const;

function getSymbolsForUniverse(universe: string): string[] {
  if (universe === "all") {
    const { rows } = getScreenerSnapshot({ limit: 20000, filters: {} });
    return rows.map((r) => r.symbol);
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

export async function GET(request: NextRequest) {
  const _perfStart = performance.now();
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
      const latest = getLatestScreenerDate();
      return NextResponse.json({ date: latest }, {
        headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" },
      });
    }

    if (params.has("countOnly")) {
      const { count, date: snapshotDate } = getScreenerCount({
        date: date ?? undefined,
        symbols,
        filters,
      });
      return NextResponse.json({ count, date: snapshotDate }, {
        headers: { "Cache-Control": "public, max-age=120, stale-while-revalidate=600" },
      });
    }

    const scriptBody = params.get("scriptBody") ?? params.get("script") ?? "";
    if (scriptBody.trim()) {
      const asOfDate = date ?? getLatestScreenerDate();
      if (!asOfDate) {
        return NextResponse.json({ date: null, rows: [], error: "No screener date available" }, { status: 200 });
      }
      let scriptSymbols = symbols;
      if (!scriptSymbols || scriptSymbols.length === 0) {
        const universe = params.get("universe") ?? "all";
        scriptSymbols = getSymbolsForUniverse(universe);
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
      const { rows, date: snapshotDate } = getScreenerSnapshot({
        date: asOfDate,
        symbols: passingSymbols,
        limit: limit != null ? parseInt(limit, 10) : undefined,
        offset: offset != null ? parseInt(offset, 10) : undefined,
        filters: {},
      });
      const merged = rows.map((r) => {
        const sym = (r as { symbol?: string }).symbol;
        const extra = sym && scriptValues[sym] ? scriptValues[sym] : {};
        return { ...r, ...extra };
      });
      return NextResponse.json({ date: snapshotDate, rows: merged, scriptColumns }, {
        headers: { "Cache-Control": "public, max-age=120, stale-while-revalidate=600" },
      });
    }

    const { rows, date: snapshotDate } = getScreenerSnapshot({
      date,
      symbols,
      limit: limit != null ? parseInt(limit, 10) : undefined,
      offset: offset != null ? parseInt(offset, 10) : undefined,
      filters,
    });

    return NextResponse.json({ date: snapshotDate, rows }, {
      headers: { "Cache-Control": "public, max-age=120, stale-while-revalidate=600" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Screener error";
    recordPerf("api", "/api/screener", Math.round(performance.now() - _perfStart), { status: 500 });
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    recordPerf("api", "/api/screener", Math.round(performance.now() - _perfStart));
  }
}
