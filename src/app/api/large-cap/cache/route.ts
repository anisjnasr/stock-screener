import { NextRequest, NextResponse } from "next/server";
import {
  fetchLargeCapPremarketQuotesForSymbols,
  type LargeCapPremarketQuotePayload,
} from "@/lib/premarket/large-cap-premarket-snapshot";
import { fetchPythonLargeCapCacheHydrate, isPythonServiceConfigured } from "@/lib/python-service";
import { largeCapPythonRequestDates } from "@/lib/premarket/large-cap-analysis-date";

export const dynamic = "force-dynamic";

type Body = {
  profile_id?: string;
  tickers?: string[];
  data_mode?: string;
  analysis_date?: string | null;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeTicker(raw: unknown): string | null {
  const s = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  if (!s || s.length > 12) return null;
  if (!/^[-A-Z0-9.]+$/.test(s)) return null;
  return s;
}

/**
 * POST JSON `{ profile_id, tickers[], data_mode, analysis_date? }`.
 * Returns Supabase cache hits only — never calls Claude on miss.
 */
export async function POST(request: NextRequest) {
  if (!isPythonServiceConfigured()) {
    return NextResponse.json(
      { ok: false, error: "PYTHON_SERVICE_URL and PYTHON_SERVICE_KEY must be set." },
      { status: 503 }
    );
  }

  let body: Body = {};
  try {
    body = (await request.json()) as Body;
  } catch {
    body = {};
  }

  const profileId = typeof body.profile_id === "string" ? body.profile_id.trim() : "";
  if (!UUID_RE.test(profileId)) {
    return NextResponse.json({ ok: false, error: "Invalid or missing profile_id (UUID)" }, { status: 400 });
  }

  const tickers = [...new Set(
    (Array.isArray(body.tickers) ? body.tickers : [])
      .map(normalizeTicker)
      .filter((t): t is string => Boolean(t))
  )];
  if (tickers.length === 0) {
    return NextResponse.json({ ok: false, error: "Invalid or missing tickers" }, { status: 400 });
  }
  if (tickers.length > 50) {
    return NextResponse.json({ ok: false, error: "At most 50 tickers per hydrate" }, { status: 400 });
  }

  const modeRaw = typeof body.data_mode === "string" ? body.data_mode.trim().toLowerCase() : "historical";
  if (modeRaw !== "historical" && modeRaw !== "historical_premarket") {
    return NextResponse.json(
      { ok: false, error: "data_mode must be historical or historical_premarket" },
      { status: 400 }
    );
  }

  const { analysisDate, dbLatestCompletedDate } = largeCapPythonRequestDates(body.analysis_date);

  let premarketSnapshots: Record<string, LargeCapPremarketQuotePayload> | null = null;
  if (modeRaw === "historical_premarket") {
    try {
      const snap = await fetchLargeCapPremarketQuotesForSymbols(tickers, { signal: request.signal });
      premarketSnapshots = snap.byTicker;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ ok: false, error: `Massive snapshot failed: ${msg}` }, { status: 503 });
    }
  }

  try {
    const rows = await fetchPythonLargeCapCacheHydrate({
      profileId,
      tickers,
      dataMode: modeRaw,
      analysisDate,
      dbLatestCompletedDate,
      premarketSnapshots: modeRaw === "historical_premarket" ? premarketSnapshots : null,
      signal: request.signal,
    });
    return NextResponse.json({ ok: true, rows });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 503 });
  }
}
