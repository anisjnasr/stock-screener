import { NextRequest, NextResponse } from "next/server";
import { addCalendarDaysYmd, ymdInEt } from "@/lib/et-ymd";
import { ingestEarningsForWindow } from "@/lib/premarket/earnings-ingest";
import { getSupabaseService } from "@/lib/supabase";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

/**
 * Refetch a wider Finnhub window so EPS/revenue actuals and surprise % backfill after the print.
 * POST — Bearer CRON_SECRET (e.g. weekday afternoons ET).
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
    const from = addCalendarDaysYmd(today, -14);
    const to = addCalendarDaysYmd(today, 2);
    const { upserted, errors, parsed } = await ingestEarningsForWindow(supabase, from, to, {
      signal: request.signal,
    });
    if (errors.length) {
      for (const line of errors) console.error("[cron/earnings/actuals]", line);
    }
    return NextResponse.json({
      ok: true,
      window: { from, to },
      parsed,
      upserted,
      errors: errors.length ? errors : undefined,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("[cron/earnings/actuals]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
