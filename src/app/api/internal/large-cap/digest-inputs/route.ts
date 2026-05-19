import { NextRequest, NextResponse } from "next/server";
import { fetchLargeCapDigestInputs } from "@/lib/premarket/large-cap-digest-inputs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authorize(request: NextRequest): boolean {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return false;
  const token = auth.slice(7).trim();
  const pyKey = process.env.PYTHON_SERVICE_KEY?.trim();
  const admin = process.env.ADMIN_SECRET?.trim();
  return Boolean((pyKey && token === pyKey) || (admin && token === admin));
}

/**
 * GET/POST — bar + indicator inputs for Python Large Cap digest (remote DB mode).
 * Python on 512MB Starter fetches this instead of mirroring screener.db.
 */
export async function GET(request: NextRequest) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ticker = request.nextUrl.searchParams.get("ticker")?.trim().toUpperCase() ?? "";
  const analysisDate = request.nextUrl.searchParams.get("analysis_date");

  if (!ticker) {
    return NextResponse.json({ error: "ticker is required" }, { status: 400 });
  }

  try {
    const inputs = fetchLargeCapDigestInputs(ticker, analysisDate);
    return NextResponse.json({ ok: true, inputs });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { ticker?: string; analysis_date?: string | null } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const ticker = typeof body.ticker === "string" ? body.ticker.trim().toUpperCase() : "";
  if (!ticker) {
    return NextResponse.json({ error: "ticker is required" }, { status: 400 });
  }

  try {
    const inputs = fetchLargeCapDigestInputs(ticker, body.analysis_date);
    return NextResponse.json({ ok: true, inputs });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
