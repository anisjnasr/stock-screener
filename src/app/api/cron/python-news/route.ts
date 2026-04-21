import { NextRequest, NextResponse } from "next/server";
import { fetchPythonTickerNews, isPythonServiceConfigured } from "@/lib/python-service";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

/**
 * Proxy to Phase 12A Python `POST /news` (yfinance headlines per ticker).
 * POST — Bearer CRON_SECRET. Body: `{ "tickers": ["AAPL","MSFT"], "hours_back": 24 }`.
 * Use for smoke tests and future Stocks in Play batch jobs.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) return unauthorized();

  if (!isPythonServiceConfigured()) {
    return NextResponse.json(
      { error: "PYTHON_SERVICE_URL and PYTHON_SERVICE_KEY are not set" },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const o = body as { tickers?: unknown; hours_back?: unknown };
  if (!Array.isArray(o.tickers)) {
    return NextResponse.json({ error: "tickers must be an array of strings" }, { status: 400 });
  }
  const tickers = o.tickers.filter((x): x is string => typeof x === "string" && x.trim() !== "");
  if (tickers.length === 0) {
    return NextResponse.json({ error: "tickers must be a non-empty array" }, { status: 400 });
  }

  let hoursBack: number | undefined;
  if (o.hours_back != null) {
    if (typeof o.hours_back !== "number" || !Number.isFinite(o.hours_back)) {
      return NextResponse.json({ error: "hours_back must be a number" }, { status: 400 });
    }
    hoursBack = o.hours_back;
  }

  try {
    const news = await fetchPythonTickerNews({
      tickers,
      hoursBack,
      signal: request.signal,
    });
    return NextResponse.json({ ok: true, ...news });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("[cron/python-news]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
