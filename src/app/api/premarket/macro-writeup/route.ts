import { NextRequest, NextResponse } from "next/server";
import { ymdInEt } from "@/lib/et-ymd";
import { getSupabase } from "@/lib/supabase";
import type { DailyMacroWriteupRow } from "@/types/newsletter-macro";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public read of today's (or `?date=YYYY-MM-DD`) macro writeup via anon Supabase (RLS).
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
    .from("daily_macro_writeup")
    .select("id,writeup_date,writeup_text,source_newsletter_ids,model_used,fallback_used,generated_at,is_flagged")
    .eq("writeup_date", ymd)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({
      ok: true,
      ymd,
      row: null,
    });
  }

  return NextResponse.json({
    ok: true,
    ymd,
    row: data as DailyMacroWriteupRow,
  });
}
