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
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");

    const stmt = db.prepare(
      `INSERT OR REPLACE INTO daily_bars (symbol, date, open, high, low, close, volume)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );

    const insertBatch = db.transaction((batch: BarPayload[]) => {
      for (const b of batch) {
        stmt.run(b.symbol, b.date, b.open, b.high, b.low, b.close, b.volume);
        inserted++;
      }
    });

    insertBatch(bars);
    db.close();
    resetDbConnection();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg, inserted }, { status: 500 });
  }

  return NextResponse.json({ ok: true, inserted });
}
