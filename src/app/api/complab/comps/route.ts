import { NextRequest, NextResponse } from "next/server";
import { mapHistoricalAnaloguesToCompLabComps } from "@/lib/complab/comp-lab-comps";
import { nextTradingSessionAfter } from "@/lib/complab/reference-dates";
import { largeCapDbLatestCompletedDate } from "@/lib/premarket/large-cap-analysis-date";
import { fetchPythonLargeCapDigest, isPythonServiceConfigured } from "@/lib/python-service";
import { getDailyBars, getLatestScreenerDate } from "@/lib/screener-db-native";

export const dynamic = "force-dynamic";

type Body = {
  ticker?: string;
  reference_date?: string;
};

function normalizeTicker(raw: unknown): string | null {
  const s = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  if (!s || s.length > 12) return null;
  if (!/^[-A-Z0-9.]+$/.test(s)) return null;
  return s;
}

export async function POST(request: NextRequest) {
  if (!isPythonServiceConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "PYTHON_SERVICE_URL and PYTHON_SERVICE_KEY must be set for Comp Lab (same secret as Python INTERNAL_API_KEY).",
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
  const referenceDate = typeof body.reference_date === "string" ? body.reference_date.trim() : "";
  if (!ticker) {
    return NextResponse.json({ ok: false, error: "Invalid or missing ticker" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(referenceDate)) {
    return NextResponse.json({ ok: false, error: "reference_date must be YYYY-MM-DD" }, { status: 400 });
  }

  const latest = getLatestScreenerDate();
  if (!latest) {
    return NextResponse.json({ ok: false, error: "No screener date available" }, { status: 503 });
  }

  const bars = getDailyBars(ticker, latest, 5000)
    .slice()
    .reverse()
    .map((b) => b.date);
  const analysisDate = nextTradingSessionAfter(referenceDate, bars);
  if (!analysisDate) {
    return NextResponse.json(
      {
        ok: false,
        error: `No completed session after ${referenceDate}. Pick an earlier reference date.`,
      },
      { status: 400 }
    );
  }

  try {
    const py = await fetchPythonLargeCapDigest({
      ticker,
      dataMode: "historical",
      analysisDate,
      dbLatestCompletedDate: largeCapDbLatestCompletedDate(),
      labModeReferenceDate: referenceDate,
      signal: request.signal,
    });

    const block = py.digest?.historical_analogues;
    const mapped = mapHistoricalAnaloguesToCompLabComps(block);

    return NextResponse.json({
      ok: true,
      reference_date: referenceDate,
      analysis_date: analysisDate,
      rated_count: 0,
      ...mapped,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 503 });
  }
}
