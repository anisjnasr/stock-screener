import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { runEconomicActualsWebSearch } from "@/lib/sources/economicActualsWebSearch";
import { getSupabaseService } from "@/lib/supabase";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

/**
 * Backfill `economic_events.actual` via Claude web_search for due rows with missing actuals.
 * POST — Bearer CRON_SECRET.
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

  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!anthropicKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set" }, { status: 503 });
  }

  try {
    const anthropic = new Anthropic({ apiKey: anthropicKey });
    const { examined, updated, skipped, errors } = await runEconomicActualsWebSearch(supabase, anthropic);
    if (errors.length) {
      for (const line of errors) console.error("[economic-actuals]", line);
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
    console.error("[economic-actuals]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
