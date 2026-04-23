import { NextRequest, NextResponse } from "next/server";
import { upsertEconomicEvents } from "@/lib/economic-events-upsert";
import { getSupabaseService } from "@/lib/supabase";
import { fetchForexFactoryCalendarXml, parseForexFactoryHighMediumImpactUsd } from "@/lib/sources/forexFactoryCalendar";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

/**
 * Ingest US high- and medium-impact events from Forex Factory weekly XML into Supabase.
 * Secured with CRON_SECRET (Bearer), same pattern as admin routes.
 *
 * POST — run on schedule (e.g. Render cron every 6h) or manually via curl.
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

  try {
    const xml = await fetchForexFactoryCalendarXml({ signal: request.signal });
    const rows = parseForexFactoryHighMediumImpactUsd(xml);
    const { upserted, errors } = await upsertEconomicEvents(supabase, rows);
    if (errors.length) {
      for (const line of errors) console.error("[economic-calendar]", line);
    }
    return NextResponse.json({
      ok: true,
      parsed: rows.length,
      upserted,
      errors: errors.length ? errors : undefined,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("[economic-calendar]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
