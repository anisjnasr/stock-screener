import { NextRequest, NextResponse } from "next/server";
import { addCalendarDaysYmd, ymdInEt } from "@/lib/et-ymd";
import { ingestEarningsForWindow } from "@/lib/premarket/earnings-ingest";
import { getSupabaseService } from "@/lib/supabase";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

/**
 * Finnhub calendar/earnings → `earnings_calendar` for today ET through +6 calendar days (full week window).
 * POST — Bearer CRON_SECRET. Requires `FINNHUB_API_KEY` and a populated `big_name_universe`.
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

  if (!process.env.FINNHUB_API_KEY?.trim()) {
    return NextResponse.json({ error: "FINNHUB_API_KEY is not set" }, { status: 503 });
  }

  try {
    const today = ymdInEt();
    const to = addCalendarDaysYmd(today, 6);
    const { upserted, errors, parsed } = await ingestEarningsForWindow(supabase, today, to, {
      signal: request.signal,
    });
    if (errors.length) {
      for (const line of errors) console.error("[cron/earnings/ingest]", line);
    }
    return NextResponse.json({
      ok: true,
      window: { from: today, to },
      parsed,
      upserted,
      errors: errors.length ? errors : undefined,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("[cron/earnings/ingest]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
