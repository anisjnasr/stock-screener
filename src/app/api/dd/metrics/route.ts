import { NextRequest, NextResponse } from "next/server";
import { buildMetrics, normalizeTicker } from "@/lib/dd/metrics";
import { getOverride } from "@/lib/dd/store";
import {
  computeFloatRisk,
  computeCashNeed,
} from "@/lib/dd/verdict";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/dd/metrics?ticker=XYZ — phase-1 fast metrics (spec §5).
 * Applies dd_overrides (authoritative). Verdict is NOT finalized here (phase 2 owns it);
 * we return provisional cash_need + float_risk signals so the skeleton can paint.
 */
export async function GET(request: NextRequest) {
  const ticker = normalizeTicker(request.nextUrl.searchParams.get("ticker"));
  if (!ticker) {
    return NextResponse.json({ ok: false, error: "Invalid or missing ticker" }, { status: 400 });
  }

  // Overrides are best-effort: a missing table should not break the fast path.
  let override = null;
  const ov = await getOverride(ticker);
  if (ov.ok) override = ov.data;

  try {
    const result = await buildMetrics(ticker, override, request.signal);
    if (!result.found) {
      return NextResponse.json({ ok: true, ticker, found: false });
    }
    const m = result.metrics;
    return NextResponse.json({
      ok: true,
      ticker,
      found: true,
      metrics: m,
      provisional_signals: {
        cash_need: computeCashNeed(m.runway_months, m.cash_flow_positive),
        float_risk: computeFloatRisk(m.float),
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
