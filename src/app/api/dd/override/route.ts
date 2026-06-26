import { NextRequest, NextResponse } from "next/server";
import { normalizeTicker } from "@/lib/dd/metrics";
import { DD_SETUP_MESSAGE, upsertOverride } from "@/lib/dd/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { ticker?: string; float_override?: unknown; market_cap_override?: unknown };

function normalizeBigint(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[, ]/g, ""));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

/**
 * PUT /api/dd/override — upsert a per-ticker manual override (spec §9).
 * Body: { ticker, float_override?, market_cap_override? }. The client re-runs
 * /api/dd/metrics after saving so the cards + verdict inputs reflect the override.
 */
export async function PUT(request: NextRequest) {
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

  const result = await upsertOverride({
    ticker,
    float_override: normalizeBigint(body.float_override),
    market_cap_override: normalizeBigint(body.market_cap_override),
  });

  if (!result.ok) {
    if (result.setupRequired) {
      return NextResponse.json({ ok: false, setupRequired: true, error: DD_SETUP_MESSAGE }, { status: 503 });
    }
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true, override: result.data });
}
