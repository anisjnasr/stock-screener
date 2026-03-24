import { NextResponse } from "next/server";
import { existsSync, statSync, readdirSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import {
  getLatestScreenerDate,
  getOwnershipNative,
  getFinancialsNative,
} from "@/lib/screener-db-native";
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
  const dbBackend: "better-sqlite3" | "none" = hasDb ? "better-sqlite3" : "none";
  let ownership: {
    rows: number;
    symbols: number;
    latestReportDate: string | null;
  } | null = null;
  let financials: {
    rows: number;
    symbols: number;
    latestPeriodEnd: string | null;
    annualRows: number;
    quarterlyRows: number;
  } | null = null;
  let quoteDaily: {
    latestQuoteDate: string | null;
    latestBarsDate: string | null;
  } | null = null;

  if (hasDb) {
    try {
      dbUpdatedAt = statSync(dbPath).mtime.toISOString();
    } catch {
      dbUpdatedAt = null;
    }
  }

  if (hasDb) {
    try {
      latestScreenerDate = getLatestScreenerDate();
    } catch {
      latestScreenerDate = null;
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

  let dbSizeMB: number | null = null;
  let diskFreeMB: number | null = null;
  let diskTotalMB: number | null = null;
  let dataFiles: string[] = [];
  if (hasDb) {
    try { dbSizeMB = Math.round(statSync(dbPath).size / 1024 / 1024); } catch {}
  }
  try {
    const dataDir = join(process.cwd(), "data");
    dataFiles = readdirSync(dataDir).map(f => {
      try { return `${f} (${Math.round(statSync(join(dataDir, f)).size / 1024 / 1024)}MB)`; }
      catch { return f; }
    });
  } catch {}
  try {
    const dfOut = execSync("df -m /app/data 2>/dev/null || df -m . 2>/dev/null", { encoding: "utf8" });
    const lines = dfOut.trim().split("\n");
    if (lines.length >= 2) {
      const parts = lines[1].split(/\s+/);
      diskTotalMB = parseInt(parts[1]) || null;
      diskFreeMB = parseInt(parts[3]) || null;
    }
  } catch {}

  let sqliteIntegrityOk: boolean | null = null;
  if (hasDb) {
    try {
      const db2 = new Database(dbPath, { readonly: true });
      const result = db2.prepare("PRAGMA quick_check(1)").get() as { quick_check: string } | undefined;
      sqliteIntegrityOk = result?.quick_check === "ok";
      db2.close();
    } catch {
      sqliteIntegrityOk = false;
    }
  }

  let tableRowCounts: Record<string, number> = {};
  if (hasDb) {
    try {
      const db3 = new Database(dbPath, { readonly: true });
      const tables = db3.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
      for (const t of tables) {
        try {
          const r = db3.prepare(`SELECT COUNT(*) as c FROM "${t.name}"`).get() as CountRow | undefined;
          tableRowCounts[t.name] = r?.c ?? 0;
        } catch {}
      }
      db3.close();
    } catch {}
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
      disk: { dbSizeMB, diskFreeMB, diskTotalMB, dataFiles },
      sqliteIntegrityOk,
      tableRowCounts,
      timestamp: new Date().toISOString(),
    },
    {
      status,
      headers: { "Cache-Control": "no-cache, max-age=0" },
    }
  );
}
