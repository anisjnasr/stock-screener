import type { SupabaseClient } from "@supabase/supabase-js";
import type { DailyThemeRow } from "@/types/daily-themes";

export async function fetchDailyThemesForDate(supabase: SupabaseClient, ymd: string): Promise<DailyThemeRow[]> {
  const { data, error } = await supabase
    .from("daily_themes")
    .select(
      "id,theme_date,theme_type,theme_rank,theme_title,theme_description,asset_implications,key_watch,industry,exemplar_tickers,trigger_signals,persistence_days,is_new,model_used,generated_at"
    )
    .eq("theme_date", ymd)
    .order("theme_type", { ascending: true })
    .order("theme_rank", { ascending: true });

  if (error) {
    console.warn("[dailyThemesRead]", error.message);
    return [];
  }
  return (data ?? []) as DailyThemeRow[];
}

/** Compact text for downstream prompt continuity. */
export function summarizeThemesForMacroPrompt(rows: DailyThemeRow[]): string {
  if (!rows.length) return "";
  const macro = rows.filter((r) => r.theme_type === "macro");
  const ind = rows.filter((r) => r.theme_type === "industry");
  const lines: string[] = [];
  if (macro.length) {
    lines.push("Major news:");
    for (const r of macro) {
      lines.push(`  ${r.theme_rank}. ${r.theme_title} — ${r.theme_description.slice(0, 220)}${r.theme_description.length > 220 ? "…" : ""}`);
    }
  }
  if (ind.length) {
    lines.push("Industry:");
    for (const r of ind) {
      const indLabel = r.industry ? ` (${r.industry})` : "";
      lines.push(`  ${r.theme_rank}. ${r.theme_title}${indLabel} — ${r.theme_description.slice(0, 180)}${r.theme_description.length > 180 ? "…" : ""}`);
    }
  }
  return lines.join("\n");
}
