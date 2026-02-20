import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { adaptFundamentals, getNextEarningsDate } from "@/lib/data-adapter";
import type { Fundamentals } from "@/lib/types";

const FINNHUB_KEY = process.env.FINNHUB_API_KEY;
const BASE = "https://finnhub.io/api/v1";

export async function GET(req: NextRequest) {
  const err = requireApiKey(req);
  if (err) return err;
  const symbol = req.nextUrl.searchParams.get("symbol");
  if (!symbol) {
    return NextResponse.json({ error: "Missing symbol" }, { status: 400 });
  }
  if (!FINNHUB_KEY) {
    return NextResponse.json({ error: "Missing FINNHUB_API_KEY" }, { status: 500 });
  }
  try {
    const [metricRes, earningsRes] = await Promise.all([
      fetch(
        `${BASE}/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all&token=${FINNHUB_KEY}`,
        { next: { revalidate: 3600 } }
      ),
      fetch(
        `${BASE}/stock/earnings-calendar?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_KEY}`,
        { next: { revalidate: 86400 } }
      ),
    ]);
    const metricData = (await metricRes.json()) as Record<string, unknown>;
    const earningsData = (await earningsRes.json()) as { earningsCalendar?: unknown[] };
    const metric = (metricData.metric ?? metricData) as Record<string, unknown>;
    const fundamentals: Fundamentals = {
      ...adaptFundamentals(metric, symbol),
      symbol,
      nextEarningsDate: getNextEarningsDate(earningsData.earningsCalendar ?? []),
    };
    return NextResponse.json(fundamentals);
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Failed to fetch fundamentals" },
      { status: 502 }
    );
  }
}
