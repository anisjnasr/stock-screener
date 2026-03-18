import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import { join } from "path";
import { existsSync, readFileSync, writeFileSync } from "fs";
import {
  getLatestCompletedTradingDate,
  getIndexBreadthSeries,
  getIndexNetNewHighSeries,
} from "@/lib/screener-db-native";

type BreadthIndexId = "sp500" | "nasdaq";

type BreadthPayload = {
  indexId: BreadthIndexId;
  latestDate: string | null;
  startDate: string | null;
  netNewHighs: {
    oneMonth: Array<{ date: string; highs: number; lows: number; net: number }>;
    threeMonths: Array<{ date: string; highs: number; lows: number; net: number }>;
    sixMonths: Array<{ date: string; highs: number; lows: number; net: number }>;
    fiftyTwoWeek: Array<{ date: string; highs: number; lows: number; net: number }>;
  };
  breadth: Array<{
    date: string;
    pctAbove50d: number | null;
    pctAbove200d: number | null;
    count50d: number;
    count200d: number;
  }>;
};

const CACHE_PATH = join(process.cwd(), "data", "breadth-cache.json");
const CACHE_VERSION = 1;
type DiskCache = {
  version: number;
  items: Record<string, BreadthPayload>;
};

function persistBreadthSeries(
  indexId: BreadthIndexId,
  latestDate: string,
  rows: {
    nnh1m: Array<{ date: string; net: number }>;
    nnh3m: Array<{ date: string; net: number }>;
    nnh6m: Array<{ date: string; net: number }>;
    nnh52w: Array<{ date: string; net: number }>;
    breadth: Array<{ date: string; pctAbove50d: number | null; pctAbove200d: number | null }>;
  }
) {
  const dbPath = join(process.cwd(), "data", "screener.db");
  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS breadth_daily (
        index_id TEXT NOT NULL,
        date TEXT NOT NULL,
        nnh_1m REAL,
        nnh_3m REAL,
        nnh_6m REAL,
        nnh_52w REAL,
        pct_above_50d REAL,
        pct_above_200d REAL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (index_id, date)
      );
      CREATE INDEX IF NOT EXISTS idx_breadth_daily_date ON breadth_daily(date);
    `);

    const byDate = new Map<
      string,
      {
        nnh1m?: number;
        nnh3m?: number;
        nnh6m?: number;
        nnh52w?: number;
        pct50?: number | null;
        pct200?: number | null;
      }
    >();

    for (const r of rows.nnh1m) byDate.set(r.date, { ...(byDate.get(r.date) ?? {}), nnh1m: r.net });
    for (const r of rows.nnh3m) byDate.set(r.date, { ...(byDate.get(r.date) ?? {}), nnh3m: r.net });
    for (const r of rows.nnh6m) byDate.set(r.date, { ...(byDate.get(r.date) ?? {}), nnh6m: r.net });
    for (const r of rows.nnh52w) byDate.set(r.date, { ...(byDate.get(r.date) ?? {}), nnh52w: r.net });
    for (const r of rows.breadth) {
      byDate.set(r.date, {
        ...(byDate.get(r.date) ?? {}),
        pct50: r.pctAbove50d,
        pct200: r.pctAbove200d,
      });
    }

    const upsert = db.prepare(`
      INSERT INTO breadth_daily (
        index_id, date, nnh_1m, nnh_3m, nnh_6m, nnh_52w, pct_above_50d, pct_above_200d, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(index_id, date) DO UPDATE SET
        nnh_1m = excluded.nnh_1m,
        nnh_3m = excluded.nnh_3m,
        nnh_6m = excluded.nnh_6m,
        nnh_52w = excluded.nnh_52w,
        pct_above_50d = excluded.pct_above_50d,
        pct_above_200d = excluded.pct_above_200d,
        updated_at = excluded.updated_at
    `);

    const nowIso = new Date().toISOString();
    for (const [date, v] of byDate.entries()) {
      upsert.run(
        indexId,
        date,
        v.nnh1m ?? null,
        v.nnh3m ?? null,
        v.nnh6m ?? null,
        v.nnh52w ?? null,
        v.pct50 ?? null,
        v.pct200 ?? null,
        nowIso
      );
    }
    // Keep only trailing 2 years for this index to bound table growth.
    db.prepare(
      `
      DELETE FROM breadth_daily
      WHERE index_id = ?
        AND date < ?
      `
    ).run(indexId, (() => {
      const d = new Date(`${latestDate}T00:00:00Z`);
      d.setUTCFullYear(d.getUTCFullYear() - 2);
      return d.toISOString().slice(0, 10);
    })());
  } finally {
    db.close();
  }
}

export async function GET(request: NextRequest) {
  try {
    const indexParam = String(request.nextUrl.searchParams.get("index") ?? "sp500").toLowerCase();
    const indexId: BreadthIndexId = indexParam === "nasdaq" ? "nasdaq" : "sp500";
    const latestDate = getLatestCompletedTradingDate();
    if (!latestDate) {
      return NextResponse.json({
        indexId,
        latestDate: null,
        startDate: null,
        netNewHighs: { oneMonth: [], threeMonths: [], sixMonths: [], fiftyTwoWeek: [] },
        breadth: [],
      } satisfies BreadthPayload);
    }

    const start = new Date(`${latestDate}T00:00:00Z`);
    start.setUTCFullYear(start.getUTCFullYear() - 2);
    const startDate = start.toISOString().slice(0, 10);
    const cacheKey = `${indexId}:${latestDate}:${startDate}`;

    if (existsSync(CACHE_PATH)) {
      try {
        const parsed = JSON.parse(readFileSync(CACHE_PATH, "utf8")) as DiskCache;
        if (
          parsed &&
          parsed.version === CACHE_VERSION &&
          parsed.items &&
          parsed.items[cacheKey]
        ) {
          return NextResponse.json(parsed.items[cacheKey]);
        }
      } catch {
        /* ignore cache read errors */
      }
    }

    const nnh1m = getIndexNetNewHighSeries(indexId, 21, startDate, latestDate);
    const nnh3m = getIndexNetNewHighSeries(indexId, 63, startDate, latestDate);
    const nnh6m = getIndexNetNewHighSeries(indexId, 126, startDate, latestDate);
    const nnh52w = getIndexNetNewHighSeries(indexId, 252, startDate, latestDate);
    const breadth = getIndexBreadthSeries(indexId, startDate, latestDate);

    try {
      persistBreadthSeries(indexId, latestDate, {
        nnh1m: nnh1m.rows,
        nnh3m: nnh3m.rows,
        nnh6m: nnh6m.rows,
        nnh52w: nnh52w.rows,
        breadth: breadth.rows,
      });
    } catch {
      // Persistence is best-effort; API responses should still succeed even when
      // the runtime filesystem/database is read-only.
    }

    const payload = {
      indexId,
      latestDate,
      startDate,
      netNewHighs: {
        oneMonth: nnh1m.rows,
        threeMonths: nnh3m.rows,
        sixMonths: nnh6m.rows,
        fiftyTwoWeek: nnh52w.rows,
      },
      breadth: breadth.rows,
    } satisfies BreadthPayload;

    try {
      let cache: DiskCache = { version: CACHE_VERSION, items: {} };
      if (existsSync(CACHE_PATH)) {
        const parsed = JSON.parse(readFileSync(CACHE_PATH, "utf8")) as DiskCache;
        if (parsed && parsed.version === CACHE_VERSION && parsed.items) cache = parsed;
      }
      cache.items[cacheKey] = payload;
      const keys = Object.keys(cache.items);
      if (keys.length > 24) {
        for (const k of keys.slice(0, keys.length - 24)) delete cache.items[k];
      }
      writeFileSync(CACHE_PATH, JSON.stringify(cache), "utf8");
    } catch {
      /* ignore cache write errors */
    }

    return NextResponse.json(payload);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Breadth error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

