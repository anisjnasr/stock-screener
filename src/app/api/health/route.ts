import { NextResponse } from "next/server";
import { existsSync, statSync } from "fs";
import { join } from "path";

export async function GET() {
  const dbPath = join(process.cwd(), "data", "screener.db");
  const hasDb = existsSync(dbPath);
  let latestScreenerDate: string | null = null;
  let dbUpdatedAt: string | null = null;
  let dbBackend: "better-sqlite3" | "sql.js-fallback" | "none" = "none";

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
      hasApiKey: Boolean(process.env.MASSIVE_API_KEY),
      timestamp: new Date().toISOString(),
    },
    { status }
  );
}
