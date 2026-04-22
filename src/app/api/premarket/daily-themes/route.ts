import { NextRequest, NextResponse } from "next/server";
import { ymdInEt } from "@/lib/et-ymd";
import { getSupabase } from "@/lib/supabase";
import { isSupabaseTableMissingError } from "@/lib/supabase-table-errors";
import type { DailyThemeRow } from "@/types/daily-themes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public read of today's (or `?date=YYYY-MM-DD`) daily themes via anon Supabase (RLS).
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
    .from("daily_themes")
    .select(
      "id,theme_date,theme_type,theme_rank,theme_title,theme_description,asset_implications,key_watch,industry,exemplar_tickers,trigger_signals,persistence_days,is_new,model_used,generated_at"
    )
    .eq("theme_date", ymd)
    .order("theme_type", { ascending: true })
    .order("theme_rank", { ascending: true });

  if (error) {
    if (isSupabaseTableMissingError(error.message)) {
      return NextResponse.json({
        ok: true,
        ymd,
        themes: [] as DailyThemeRow[],
        setupRequired: true,
        setupMessage:
          "Database table `daily_themes` is missing. In Supabase → SQL Editor, run `data/supabase-premarket-brief-tables.sql` from this repo, then reload.",
      });
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    ymd,
    themes: (data ?? []) as DailyThemeRow[],
  });
}
