/** One row in `daily_themes` (Phase 5). */
export type DailyThemeRow = {
  id: string;
  theme_date: string;
  theme_type: "macro" | "industry";
  theme_rank: number;
  theme_title: string;
  theme_description: string;
  asset_implications: string | null;
  key_watch: string | null;
  industry: string | null;
  exemplar_tickers: string[] | null;
  trigger_signals: string[] | null;
  persistence_days: number;
  is_new: boolean;
  model_used: string;
  generated_at: string;
};
