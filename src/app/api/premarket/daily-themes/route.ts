import { NextRequest, NextResponse } from "next/server";
import { ymdInEt } from "@/lib/et-ymd";
import { getSupabase } from "@/lib/supabase";
import { isSupabaseTableMissingError } from "@/lib/supabase-table-errors";
import type { DailyThemeRow } from "@/types/daily-themes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function latestGeneratedAt(rows: DailyThemeRow[]): string | null {
  let latestMs = Number.NEGATIVE_INFINITY;
  let latestIso: string | null = null;
  for (const row of rows) {
    const ms = Date.parse(row.generated_at);
    if (!Number.isFinite(ms)) continue;
    if (ms > latestMs) {
      latestMs = ms;
      latestIso = row.generated_at;
    }
  }
  return latestIso;
}

/**
 * Public read of the latest daily themes, or an exact `?date=YYYY-MM-DD` set.
 */
export async function GET(request: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase not configured" }, { status: 503 });
  }

  const dateParam = request.nextUrl.searchParams.get("date")?.trim();
  let ymd = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : null;
  if (!ymd) {
    const { data: latest, error: latestError } = await supabase
      .from("daily_themes")
      .select("theme_date")
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestError) {
      if (isSupabaseTableMissingError(latestError.message)) {
        return NextResponse.json({
          ok: true,
          ymd: ymdInEt(),
          themes: [] as DailyThemeRow[],
          themesUpdatedAt: null,
          setupRequired: true,
          setupMessage:
            "Database table `daily_themes` is missing. In Supabase -> SQL Editor, run `data/supabase-premarket-brief-tables.sql` from this repo, then reload.",
        });
      }
      return NextResponse.json({ ok: false, error: latestError.message }, { status: 500 });
    }
    ymd = (latest as { theme_date?: string } | null)?.theme_date ?? ymdInEt();
  }

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
        themesUpdatedAt: null,
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
    themesUpdatedAt: latestGeneratedAt((data ?? []) as DailyThemeRow[]),
  });
}
