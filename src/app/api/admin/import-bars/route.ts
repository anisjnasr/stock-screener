import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import { getScreenerDbPath } from "@/lib/data-path";
import { resetDbConnection } from "@/lib/screener-db-native";

type BarPayload = {
  symbol: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

/**
 * Bulk-import daily bars into the production DB.
 * Authenticated via ADMIN_SECRET bearer token.
 *
 * POST body: { bars: BarPayload[] }
 * Bars are inserted via INSERT OR REPLACE so existing rows are updated.
 */
export async function POST(request: NextRequest) {
  const adminSecret = process.env.ADMIN_SECRET;
  const auth = request.headers.get("authorization");
  if (!adminSecret || auth !== `Bearer ${adminSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const bars: BarPayload[] = body?.bars;
  if (!Array.isArray(bars) || bars.length === 0) {
    return NextResponse.json({ error: "No bars provided" }, { status: 400 });
  }

  const dbPath = getScreenerDbPath();
  let inserted = 0;

  try {
    resetDbConnection();
    const db = new Database(dbPath);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");
    db.exec("PRAGMA foreign_keys = OFF");
    const dailyBarsCols = new Set(
      (db.prepare("PRAGMA table_info(daily_bars)").all() as Array<{ name: string }>).map((r) => r.name)
    );
    if (!dailyBarsCols.has("dollar_volume")) {
      db.exec("ALTER TABLE daily_bars ADD COLUMN dollar_volume REAL");
    }

    const stmt = db.prepare(
      `INSERT OR REPLACE INTO daily_bars (symbol, date, open, high, low, close, volume, dollar_volume)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );

    db.exec("BEGIN");
    try {
      for (const b of bars) {
        const dollarVolume =
          b.high != null && b.low != null && b.close != null && b.volume != null
            ? ((b.high + b.low + b.close) / 3) * b.volume
            : null;
        stmt.run(b.symbol, b.date, b.open, b.high, b.low, b.close, b.volume, dollarVolume);
        inserted++;
      }
      db.exec("COMMIT");
    } catch (txErr) {
      db.exec("ROLLBACK");
      throw txErr;
    }
    db.close();
    resetDbConnection();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg, inserted }, { status: 500 });
  }

  return NextResponse.json({ ok: true, inserted });
}
