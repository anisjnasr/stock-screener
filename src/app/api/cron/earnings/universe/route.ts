import { NextRequest, NextResponse } from "next/server";
import { upsertBigNameUniverse } from "@/lib/earnings-calendar-upsert";
import { buildBigNameUniverseRows } from "@/lib/premarket/build-big-name-universe";
import { getSupabaseService } from "@/lib/supabase";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

/**
 * Refresh `big_name_universe` (S&P 500 ∪ Nasdaq-100 ∪ screener over $10B mcap when DB present).
 * POST — Bearer CRON_SECRET. Schedule monthly (e.g. 1st 03:00 ET).
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
    const rows = buildBigNameUniverseRows();
    const { upserted, errors } = await upsertBigNameUniverse(supabase, rows);
    if (errors.length) {
      for (const line of errors) console.error("[cron/earnings/universe]", line);
    }
    return NextResponse.json({
      ok: true,
      built: rows.length,
      upserted,
      errors: errors.length ? errors : undefined,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("[cron/earnings/universe]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
