import { NextRequest, NextResponse } from "next/server";
import {
  fetchLargeCapPremarketQuotesForSymbols,
  type LargeCapPremarketQuotePayload,
} from "@/lib/premarket/large-cap-premarket-snapshot";
import { isPythonServiceConfigured, streamPythonLargeCapRun } from "@/lib/python-service";

export const dynamic = "force-dynamic";

type Body = {
  profile_id?: string;
  tickers?: string[];
  ticker?: string;
  data_mode?: string;
  analysis_date?: string | null;
  force_refresh?: boolean;
  concurrency?: number;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeTicker(raw: unknown): string | null {
  const s = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  if (!s || s.length > 12) return null;
  if (!/^[-A-Z0-9.]+$/.test(s)) return null;
  return s;
}

function normalizeTickers(body: Body): string[] {
  const fromList = Array.isArray(body.tickers)
    ? body.tickers.map(normalizeTicker).filter((t): t is string => Boolean(t))
    : [];
  const single = normalizeTicker(body.ticker);
  const merged = single ? [...fromList, single] : fromList;
  return [...new Set(merged)];
}

/**
 * POST JSON `{ profile_id, tickers[], data_mode, analysis_date?, force_refresh?, concurrency? }`.
 * Streams NDJSON events from Python `/large-cap/run` (blueprint stage 7).
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

  const tickers = normalizeTickers(body);
  if (tickers.length === 0) {
    return NextResponse.json({ ok: false, error: "Invalid or missing tickers" }, { status: 400 });
  }
  if (tickers.length > 50) {
    return NextResponse.json({ ok: false, error: "At most 50 tickers per run" }, { status: 400 });
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
  const concurrency =
    typeof body.concurrency === "number" && Number.isFinite(body.concurrency)
      ? Math.min(8, Math.max(1, Math.round(body.concurrency)))
      : undefined;

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
    const upstream = await streamPythonLargeCapRun({
      profileId,
      tickers,
      dataMode: modeRaw,
      analysisDate,
      premarketSnapshots: modeRaw === "historical_premarket" ? premarketSnapshots : null,
      forceRefresh,
      concurrency,
      signal: request.signal,
    });

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text();
      return NextResponse.json(
        { ok: false, error: `Python /large-cap/run HTTP ${upstream.status}: ${text.slice(0, 400)}` },
        { status: 503 }
      );
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 503 });
  }
}
