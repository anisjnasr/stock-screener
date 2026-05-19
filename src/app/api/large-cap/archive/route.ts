import { NextRequest, NextResponse } from "next/server";
import { fetchPythonLargeCapArchiveList, isPythonServiceConfigured } from "@/lib/python-service";

export const dynamic = "force-dynamic";

type Body = {
  profile_id?: string;
  ticker?: string | null;
  date_from?: string | null;
  date_to?: string | null;
  outcome?: string | null;
  limit?: number;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST JSON `{ profile_id, ticker?, date_from?, date_to?, outcome?, limit? }`.
 * Lists Trade archive rows for the profile (blueprint §11e).
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

  const ticker =
    typeof body.ticker === "string" && body.ticker.trim() ? body.ticker.trim().toUpperCase() : null;

  const dateFrom =
    typeof body.date_from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date_from.trim())
      ? body.date_from.trim()
      : null;
  const dateTo =
    typeof body.date_to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date_to.trim())
      ? body.date_to.trim()
      : null;

  const outcome = typeof body.outcome === "string" && body.outcome.trim() ? body.outcome.trim() : null;

  try {
    const rows = await fetchPythonLargeCapArchiveList({
      profileId,
      ticker,
      dateFrom,
      dateTo,
      outcome,
      limit: body.limit,
      signal: request.signal,
    });
    return NextResponse.json({ ok: true, rows });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 503 });
  }
}
