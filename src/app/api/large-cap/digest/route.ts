import { NextRequest, NextResponse } from "next/server";
import {
  fetchLargeCapPremarketQuotesForSymbols,
  type LargeCapPremarketQuotePayload,
} from "@/lib/premarket/large-cap-premarket-snapshot";
import { fetchPythonLargeCapDigest, isPythonServiceConfigured } from "@/lib/python-service";

export const dynamic = "force-dynamic";

type Body = {
  ticker?: string;
  data_mode?: string;
  analysis_date?: string | null;
};

function normalizeTicker(raw: unknown): string | null {
  const s = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  if (!s || s.length > 12) return null;
  if (!/^[-A-Z0-9.]+$/.test(s)) return null;
  return s;
}

/**
 * POST JSON `{ ticker, data_mode, analysis_date? }`.
 * When `data_mode` is `historical_premarket`, performs **one** Massive full-market snapshot
 * then forwards the ticker row to Python with the digest (blueprint §6).
 */
export async function POST(request: NextRequest) {
  if (!isPythonServiceConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "PYTHON_SERVICE_URL and PYTHON_SERVICE_KEY must be set for Large Cap digest (same secret as Python INTERNAL_API_KEY).",
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

  let premarketSnapshot: LargeCapPremarketQuotePayload | null = null;
  let snapshotTickerCount: number | undefined;

  if (modeRaw === "historical_premarket") {
    try {
      const snap = await fetchLargeCapPremarketQuotesForSymbols([ticker], { signal: request.signal });
      snapshotTickerCount = snap.snapshotTickerCount;
      premarketSnapshot = snap.byTicker[ticker] ?? null;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json(
        {
          ok: false,
          error: `Massive snapshot failed: ${msg}`,
        },
        { status: 503 }
      );
    }
  }

  try {
    const py = await fetchPythonLargeCapDigest({
      ticker,
      dataMode: modeRaw,
      analysisDate,
      premarketSnapshot: modeRaw === "historical_premarket" ? premarketSnapshot : null,
      signal: request.signal,
    });

    return NextResponse.json({
      ok: true,
      digest: py.digest ?? {},
      premarket_loaded: modeRaw === "historical_premarket" ? Boolean(premarketSnapshot) : undefined,
      snapshot_ticker_count: modeRaw === "historical_premarket" ? snapshotTickerCount : undefined,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 503 });
  }
}
