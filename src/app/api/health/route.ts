import { NextResponse } from "next/server";
import { existsSync } from "fs";
import { join } from "path";

export async function GET() {
  const dbPath = join(process.cwd(), "data", "screener.db");
  const hasDb = existsSync(dbPath);
  let latestScreenerDate: string | null = null;
  let dbBackend: "better-sqlite3" | "sql.js-fallback" | "none" = "none";

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

  const healthy = hasDb && latestScreenerDate !== null;
  const status = healthy ? 200 : 503;

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      hasDb,
      dbBackend,
      latestScreenerDate,
      hasApiKey: Boolean(process.env.MASSIVE_API_KEY),
      timestamp: new Date().toISOString(),
    },
    { status }
  );
}
