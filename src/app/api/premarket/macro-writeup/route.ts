import { NextRequest, NextResponse } from "next/server";
import { ymdInEt } from "@/lib/et-ymd";
import { getSupabase } from "@/lib/supabase";
import type { DailyMacroWriteupRow } from "@/types/newsletter-macro";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public read of the latest macro writeup, or an exact `?date=YYYY-MM-DD` row.
 */
export async function GET(request: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase not configured" }, { status: 503 });
  }

  const dateParam = request.nextUrl.searchParams.get("date")?.trim();
  const requestedYmd = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : null;
  const baseQuery = supabase
    .from("daily_macro_writeup")
    .select("id,writeup_date,writeup_text,source_newsletter_ids,model_used,fallback_used,generated_at,is_flagged");
  const { data, error } = requestedYmd
    ? await baseQuery.eq("writeup_date", requestedYmd).maybeSingle()
    : await baseQuery.order("generated_at", { ascending: false }).limit(1).maybeSingle();
  const ymd = requestedYmd ?? (data as DailyMacroWriteupRow | null)?.writeup_date ?? ymdInEt();

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
