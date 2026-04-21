import { NextRequest, NextResponse } from "next/server";
import { runFredActualsBackfill } from "@/lib/sources/fredActuals";
import { getSupabaseService } from "@/lib/supabase";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

/**
 * Backfill `economic_events.actual` from FRED for mapped rows (null actual, date in window).
 * POST — Bearer CRON_SECRET. Schedule per master spec: every 30m 8–17 ET weekdays (see GitHub workflow UTC).
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) return unauthorized();

  const supabase = getSupabaseService();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase service role not configured (SUPABASE_SERVICE_ROLE_KEY)" },
      { status: 503 }
    );
  }

  if (!process.env.FRED_API_KEY?.trim()) {
    return NextResponse.json({ error: "FRED_API_KEY is not set" }, { status: 503 });
  }

  try {
    const { examined, updated, skipped, errors } = await runFredActualsBackfill(supabase, {
      signal: request.signal,
    });
    if (errors.length) {
      for (const line of errors) console.error("[fred-actuals]", line);
    }
    return NextResponse.json({
      ok: true,
      examined,
      updated,
      skipped,
      errors: errors.length ? errors : undefined,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("[fred-actuals]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
