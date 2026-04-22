import { NextRequest, NextResponse } from "next/server";
import { ymdInEt } from "@/lib/et-ymd";
import { getSupabase } from "@/lib/supabase";
import { isSupabaseTableMissingError } from "@/lib/supabase-table-errors";
import type { DailyEquitiesWriteupRow } from "@/types/newsletter-macro";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function coerceBullets(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((b) => String(b).trim()).filter(Boolean);
}

/**
 * Public read of today's (or `?date=YYYY-MM-DD`) US equities writeup via anon Supabase (RLS).
 */
export async function GET(request: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase not configured" }, { status: 503 });
  }

  const dateParam = request.nextUrl.searchParams.get("date")?.trim();
  const ymd =
    dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : ymdInEt();

  const { data, error } = await supabase
    .from("daily_equities_writeup")
    .select("id,writeup_date,bullets,source_newsletter_ids,model_used,fallback_used,generated_at,is_flagged")
    .eq("writeup_date", ymd)
    .maybeSingle();

  if (error) {
    if (isSupabaseTableMissingError(error.message)) {
      return NextResponse.json({
        ok: true,
        ymd,
        row: null,
        setupRequired: true,
        setupMessage:
          "Database table `daily_equities_writeup` is missing. In Supabase → SQL Editor, run `data/supabase-premarket-brief-tables.sql` from this repo, then reload.",
      });
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({
      ok: true,
      ymd,
      row: null,
    });
  }

  const row = data as Omit<DailyEquitiesWriteupRow, "bullets"> & { bullets: unknown };
  const normalized: DailyEquitiesWriteupRow = {
    ...row,
    bullets: coerceBullets(row.bullets),
  };

  return NextResponse.json({
    ok: true,
    ymd,
    row: normalized,
  });
}
