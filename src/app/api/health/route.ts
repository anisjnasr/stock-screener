import { NextResponse } from "next/server";
import { existsSync, statSync } from "fs";
import { join } from "path";
import Database from "better-sqlite3";

export async function GET() {
  const dbPath = join(process.cwd(), "data", "screener.db");
  const hasDb = existsSync(dbPath);
  let latestScreenerDate: string | null = null;
  let dbUpdatedAt: string | null = null;
  let dbBackend: "better-sqlite3" | "sql.js-fallback" | "none" = "none";
  let ownership:
    | {
        rows: number;
        symbols: number;
        latestReportDate: string | null;
      }
    | null = null;
  let financials:
    | {
        rows: number;
        symbols: number;
        latestPeriodEnd: string | null;
        annualRows: number;
        quarterlyRows: number;
      }
    | null = null;
  let quoteDaily:
    | {
        latestQuoteDate: string | null;
        latestBarsDate: string | null;
      }
    | null = null;

  if (hasDb) {
    try {
      dbUpdatedAt = statSync(dbPath).mtime.toISOString();
    } catch {
      dbUpdatedAt = null;
    }
  }

  if (hasDb) {
    try {
      const { getLatestScreenerDate } = await import("@/lib/screener-db-native");
      latestScreenerDate = getLatestScreenerDate();
      dbBackend = "better-sqlite3";
    } catch {
      try {
        const { getLatestScreenerDate } = await import("@/lib/screener-db");
        latestScreenerDate = await getLatestScreenerDate();
        dbBackend = "sql.js-fallback";
      } catch {
        dbBackend = "none";
      }
    }
  }

  if (hasDb) {
    try {
      const db = new Database(dbPath, { readonly: true });
      try {
        ownership = {
          rows: Number(db.prepare("SELECT COUNT(*) AS c FROM ownership").get()?.c ?? 0),
          symbols: Number(db.prepare("SELECT COUNT(DISTINCT symbol) AS c FROM ownership").get()?.c ?? 0),
          latestReportDate: String(db.prepare("SELECT MAX(report_date) AS d FROM ownership").get()?.d ?? "") || null,
        };
        financials = {
          rows: Number(db.prepare("SELECT COUNT(*) AS c FROM financials").get()?.c ?? 0),
          symbols: Number(db.prepare("SELECT COUNT(DISTINCT symbol) AS c FROM financials").get()?.c ?? 0),
          latestPeriodEnd: String(db.prepare("SELECT MAX(period_end) AS d FROM financials").get()?.d ?? "") || null,
          annualRows: Number(
            db.prepare("SELECT COUNT(*) AS c FROM financials WHERE period_type = 'annual'").get()?.c ?? 0
          ),
          quarterlyRows: Number(
            db.prepare("SELECT COUNT(*) AS c FROM financials WHERE period_type = 'quarterly'").get()?.c ?? 0
          ),
        };
        quoteDaily = {
          latestQuoteDate: String(db.prepare("SELECT MAX(date) AS d FROM quote_daily").get()?.d ?? "") || null,
          latestBarsDate: String(db.prepare("SELECT MAX(date) AS d FROM daily_bars").get()?.d ?? "") || null,
        };
      } finally {
        db.close();
      }
    } catch {
      // Keep health endpoint resilient even if extended diagnostics fail.
    }
  }

  if (latestScreenerDate) {
    const screenerAsIso = `${latestScreenerDate}T00:00:00.000Z`;
    const fileDatePart = dbUpdatedAt ? String(dbUpdatedAt).slice(0, 10) : null;
    if (!fileDatePart || fileDatePart < latestScreenerDate) {
      dbUpdatedAt = screenerAsIso;
    }
  }

  const healthy = hasDb && latestScreenerDate !== null;
  const status = healthy ? 200 : 503;

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      hasDb,
      dbBackend,
      latestScreenerDate,
      dbUpdatedAt,
      ownership,
      financials,
      quoteDaily,
      hasApiKey: Boolean(process.env.MASSIVE_API_KEY),
      timestamp: new Date().toISOString(),
    },
    { status }
  );
}
