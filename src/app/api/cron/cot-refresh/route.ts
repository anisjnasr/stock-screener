import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase";
import { refreshCotWeekly } from "@/lib/cot/ingest";

export const runtime = "nodejs";
export const maxDuration = 120;

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function ymdDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * CFTC COT weekly refresh → `cot_weekly`.
 * POST — Bearer CRON_SECRET. Runs after the Friday CFTC release (Saturday is safe).
 * Pulls a short trailing window (default 28 days) from all three datasets per contract,
 * joins them, and upserts. Idempotent (unique constraint on contract_key, report_date).
 *
 * Optional JSON body: { "since": "YYYY-MM-DD" } to backfill a wider window on demand.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) return unauthorized();

  const supabase = getSupabaseService();
  if (!supabase) {
    return NextResponse.json(
      { ok: false, error: "Supabase service role not configured (SUPABASE_SERVICE_ROLE_KEY)" },
      { status: 503 }
    );
  }

  let since = ymdDaysAgo(28);
  try {
    const raw = (await request.json().catch(() => ({}))) as { since?: unknown };
    if (typeof raw?.since === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.since.trim())) {
      since = raw.since.trim();
    }
  } catch {
    /* use default trailing window */
  }

  try {
    const token = process.env.CFTC_APP_TOKEN?.trim() || undefined;
    const { results, totalUpserted } = await refreshCotWeekly(
      supabase,
      since,
      token,
      request.signal
    );
    const errors = results.filter((r) => r.error);
    if (errors.length) {
      for (const r of errors) console.error("[cron/cot-refresh]", r.contract, r.error);
    }
    return NextResponse.json({
      ok: errors.length === 0,
      since,
      totalUpserted,
      results,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("[cron/cot-refresh]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
