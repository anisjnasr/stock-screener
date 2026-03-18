import { NextResponse } from "next/server";
import { existsSync, statSync } from "fs";
import { join } from "path";
import Database from "better-sqlite3";

type CountRow = { c: number };
type DateRow = { d: string | null };

function readCount(db: InstanceType<typeof Database>, sql: string): number {
  const row = db.prepare(sql).get() as CountRow | undefined;
  return Number(row?.c ?? 0);
}

function readDate(db: InstanceType<typeof Database>, sql: string): string | null {
  const row = db.prepare(sql).get() as DateRow | undefined;
  const value = row?.d;
  return value != null && String(value) !== "" ? String(value) : null;
}

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
          rows: readCount(db, "SELECT COUNT(*) AS c FROM ownership"),
          symbols: readCount(db, "SELECT COUNT(DISTINCT symbol) AS c FROM ownership"),
          latestReportDate: readDate(db, "SELECT MAX(report_date) AS d FROM ownership"),
        };
        financials = {
          rows: readCount(db, "SELECT COUNT(*) AS c FROM financials"),
          symbols: readCount(db, "SELECT COUNT(DISTINCT symbol) AS c FROM financials"),
          latestPeriodEnd: readDate(db, "SELECT MAX(period_end) AS d FROM financials"),
          annualRows: readCount(db, "SELECT COUNT(*) AS c FROM financials WHERE period_type = 'annual'"),
          quarterlyRows: readCount(db, "SELECT COUNT(*) AS c FROM financials WHERE period_type = 'quarterly'"),
        };
        quoteDaily = {
          latestQuoteDate: readDate(db, "SELECT MAX(date) AS d FROM quote_daily"),
          latestBarsDate: readDate(db, "SELECT MAX(date) AS d FROM daily_bars"),
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

  const requireOwnership = String(process.env.HEALTH_REQUIRE_OWNERSHIP ?? "1") !== "0";
  const requireFinancials = String(process.env.HEALTH_REQUIRE_FINANCIALS ?? "1") !== "0";
  const ownershipHealthy = !requireOwnership || Boolean(ownership && ownership.rows > 0 && ownership.symbols > 0);
  const financialsHealthy = !requireFinancials || Boolean(financials && financials.rows > 0 && financials.symbols > 0);

  const healthy =
    hasDb &&
    latestScreenerDate !== null &&
    ownershipHealthy &&
    financialsHealthy;
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
      checks: {
        ownershipHealthy,
        financialsHealthy,
        requireOwnership,
        requireFinancials,
      },
      hasApiKey: Boolean(process.env.MASSIVE_API_KEY),
      timestamp: new Date().toISOString(),
    },
    { status }
  );
}
