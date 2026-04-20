import { NextResponse, type NextRequest } from "next/server";
import { upsertMarketEvents } from "@/lib/market-events-upsert";
import { getSupabaseService } from "@/lib/supabase";
import type { MarketEventInsert } from "@/types/market-events";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function runMarketEventIngest(
  request: NextRequest,
  opts: { source: string; loadRows: () => Promise<MarketEventInsert[]> }
): Promise<Response> {
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
    const rows = await opts.loadRows();
    const { upserted, errors } = await upsertMarketEvents(supabase, rows);
    if (errors.length) {
      for (const line of errors) console.error(`[market-events:${opts.source}]`, line);
    }
    return NextResponse.json({
      ok: true,
      source: opts.source,
      parsed: rows.length,
      upserted,
      errors: errors.length ? errors : undefined,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error(`[market-events:${opts.source}]`, message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
