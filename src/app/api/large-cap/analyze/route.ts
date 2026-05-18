import { NextRequest, NextResponse } from "next/server";
import {
  fetchLargeCapPremarketQuotesForSymbols,
  type LargeCapPremarketQuotePayload,
} from "@/lib/premarket/large-cap-premarket-snapshot";
import { fetchPythonLargeCapAnalyze, isPythonServiceConfigured } from "@/lib/python-service";

export const dynamic = "force-dynamic";

type Body = {
  profile_id?: string;
  ticker?: string;
  data_mode?: string;
  analysis_date?: string | null;
  force_refresh?: boolean;
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
 * POST JSON `{ profile_id, ticker, data_mode, analysis_date?, force_refresh? }`.
 * Digest → hash → Supabase cache → Claude on miss (blueprint §8c).
 */
export async function POST(request: NextRequest) {
  if (!isPythonServiceConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error: "PYTHON_SERVICE_URL and PYTHON_SERVICE_KEY must be set.",
      },
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

  const ticker = normalizeTicker(body.ticker);
  if (!ticker) {
    return NextResponse.json({ ok: false, error: "Invalid or missing ticker" }, { status: 400 });
  }

  const modeRaw = typeof body.data_mode === "string" ? body.data_mode.trim().toLowerCase() : "historical";
  if (modeRaw !== "historical" && modeRaw !== "historical_premarket") {
    return NextResponse.json(
      { ok: false, error: "data_mode must be historical or historical_premarket" },
      { status: 400 }
    );
  }

  const analysisDate =
    typeof body.analysis_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.analysis_date.trim())
      ? body.analysis_date.trim()
      : null;

  const forceRefresh = body.force_refresh === true;

  let premarketSnapshot: LargeCapPremarketQuotePayload | null = null;
  if (modeRaw === "historical_premarket") {
    try {
      const snap = await fetchLargeCapPremarketQuotesForSymbols([ticker], { signal: request.signal });
      premarketSnapshot = snap.byTicker[ticker] ?? null;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ ok: false, error: `Massive snapshot failed: ${msg}` }, { status: 503 });
    }
  }

  try {
    const result = await fetchPythonLargeCapAnalyze({
      profileId,
      ticker,
      dataMode: modeRaw,
      analysisDate,
      premarketSnapshot: modeRaw === "historical_premarket" ? premarketSnapshot : null,
      forceRefresh,
      signal: request.signal,
    });

    return NextResponse.json({
      ok: true,
      cache_hit: result.cache_hit,
      claude_call_made: result.claude_call_made,
      digest_hash: result.digest_hash,
      trading_date: result.trading_date,
      data_mode: result.data_mode,
      analyzed_at: result.analyzed_at,
      digest: result.digest ?? {},
      verdict: result.verdict ?? {},
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 503 });
  }
}
