import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseModelJson, PREMARKET_CLAUDE_MODEL, streamClaudeText } from "@/lib/ai/claudeStream";
import { addCalendarDaysYmd } from "@/lib/et-ymd";
import { fetchDailyThemesForDate } from "@/lib/premarket/dailyThemesRead";
import { loadGappersScanOnly, normalizeGappersScanBody } from "@/lib/premarket/gappers-ingest";
import type { DailyThemeRow } from "@/types/daily-themes";

type ThemeDraft = {
  theme_type: "macro" | "industry";
  theme_rank: number;
  theme_title: string;
  theme_description: string;
  asset_implications?: string | null;
  key_watch?: string | null;
  industry?: string | null;
  exemplar_tickers?: string[] | null;
  trigger_signals?: string[] | null;
  persistence_days?: number | null;
  is_new?: boolean | null;
};

function gapperSectorSummary(rows: { ticker: string; gapPct: number; sector: string | null; industry: string | null }[]): string {
  if (!rows.length) return "(No gappers loaded.)";
  const sorted = [...rows].sort((a, b) => b.gapPct - a.gapPct);
  const top = sorted.slice(0, 25);
  const lines = top.map((r) => {
    const sec = r.sector?.trim() || "?";
    const ind = r.industry?.trim() || "";
    return `  ${r.ticker} +${r.gapPct.toFixed(1)}% · ${sec}${ind ? ` / ${ind}` : ""}`;
  });
  return lines.join("\n");
}

export type ThemeExtractionResult =
  | { ok: true; themeDate: string; themeCount: number }
  | { ok: false; error: string };

/**
 * Builds `daily_themes` from today's macro + equities writeups, prior themes, and pre-market gappers.
 */
export async function generateAndStoreDailyThemes(
  supabase: SupabaseClient,
  anthropic: Anthropic,
  opts: { ymd: string }
): Promise<ThemeExtractionResult> {
  const { ymd } = opts;

  const [{ data: macroRow, error: mErr }, { data: eqRow, error: eErr }] = await Promise.all([
    supabase.from("daily_macro_writeup").select("writeup_text").eq("writeup_date", ymd).maybeSingle(),
    supabase.from("daily_equities_writeup").select("bullets").eq("writeup_date", ymd).maybeSingle(),
  ]);

  if (mErr) return { ok: false, error: mErr.message };
  if (eErr) return { ok: false, error: eErr.message };

  const macroText = (macroRow as { writeup_text?: string } | null)?.writeup_text?.trim() ?? "";
  const bullets = (eqRow as { bullets?: unknown } | null)?.bullets;
  const eqList = Array.isArray(bullets) ? bullets.map((b) => String(b).trim()).filter(Boolean) : [];

  if (!macroText && !eqList.length) {
    return { ok: false, error: "Missing daily_macro_writeup and daily_equities_writeup for this date" };
  }

  const priorYmd = addCalendarDaysYmd(ymd, -1);
  const priorThemes = await fetchDailyThemesForDate(supabase, priorYmd);
  const priorBlock =
    priorThemes.length > 0
      ? priorThemes
          .map(
            (t) =>
              `- [${t.theme_type} #${t.theme_rank}] ${t.theme_title}: ${t.theme_description.slice(0, 200)}${t.theme_description.length > 200 ? "…" : ""}`
          )
          .join("\n")
      : "(No prior themes.)";

  let gapperBlock: string;
  try {
    const scan = normalizeGappersScanBody({});
    const { rows } = await loadGappersScanOnly(scan, { rowLimit: 40 });
    gapperBlock = gapperSectorSummary(rows);
  } catch (e) {
    gapperBlock = `(Gappers unavailable: ${e instanceof Error ? e.message : "error"})`;
  }

  const user = [
    "Infer **5 macro themes** and **5 industry themes** that best explain today's US trading context.",
    "",
    "Inputs:",
    "",
    "### Macro writeup",
    macroText || "(empty)",
    "",
    "### Equities bullets",
    eqList.length ? eqList.map((b) => `- ${b}`).join("\n") : "(empty)",
    "",
    "### Yesterday's themes (continuity / persistence)",
    priorBlock,
    "",
    "### Pre-market gappers (sector hints)",
    gapperBlock,
    "",
    "Rules:",
    "- theme_rank must be 1–5 within each theme_type.",
    "- theme_title: short headline.",
    "- theme_description: 2–4 sentences, causal, specific.",
    "- asset_implications: how equities/sector ETFs might lean.",
    "- key_watch: what would confirm or break the theme today.",
    "- industry themes: set industry to a concise sector label; exemplar_tickers: 2–5 US tickers if inferable.",
    "- trigger_signals: 2–4 short phrases.",
    "- persistence_days: integer 1–5 (estimate carry vs one-off).",
    "- is_new: true if not a clear continuation of yesterday's same theme title.",
    "",
    "Output **only** valid JSON:",
    '{"themes":[{"theme_type":"macro","theme_rank":1,"theme_title":"","theme_description":"","asset_implications":"","key_watch":"","industry":null,"exemplar_tickers":[],"trigger_signals":[],"persistence_days":1,"is_new":true}]}',
    "Include exactly 5 macro and 5 industry objects (10 total).",
  ].join("\n");

  let raw: string;
  try {
    raw = await streamClaudeText(anthropic, {
      system:
        "You identify durable market themes for professional traders. Output strict JSON only — object with key \"themes\" array. No markdown.",
      user,
      maxTokens: 6000,
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Theme model failed" };
  }

  let parsed: { themes?: unknown };
  try {
    parsed = parseModelJson<{ themes?: unknown }>(raw);
  } catch {
    return { ok: false, error: "Theme model returned non-JSON" };
  }

  const themesRaw = parsed.themes;
  if (!Array.isArray(themesRaw)) {
    return { ok: false, error: "Invalid JSON: themes must be an array" };
  }

  const drafts = themesRaw as ThemeDraft[];
  const normalized: Omit<DailyThemeRow, "id" | "generated_at">[] = [];

  for (const t of drafts) {
    const tt = t.theme_type === "industry" ? "industry" : "macro";
    const rank = Number(t.theme_rank);
    if (!Number.isFinite(rank) || rank < 1 || rank > 5) continue;
    const title = String(t.theme_title ?? "").trim();
    const desc = String(t.theme_description ?? "").trim();
    if (!title || !desc) continue;
    normalized.push({
      theme_date: ymd,
      theme_type: tt,
      theme_rank: rank,
      theme_title: title,
      theme_description: desc,
      asset_implications: t.asset_implications != null ? String(t.asset_implications).trim() || null : null,
      key_watch: t.key_watch != null ? String(t.key_watch).trim() || null : null,
      industry: tt === "industry" && t.industry != null ? String(t.industry).trim() || null : null,
      exemplar_tickers: Array.isArray(t.exemplar_tickers)
        ? t.exemplar_tickers.map((x) => String(x).trim().toUpperCase()).filter(Boolean).slice(0, 8)
        : null,
      trigger_signals: Array.isArray(t.trigger_signals)
        ? t.trigger_signals.map((x) => String(x).trim()).filter(Boolean).slice(0, 8)
        : null,
      persistence_days:
        typeof t.persistence_days === "number" && Number.isFinite(t.persistence_days)
          ? Math.min(5, Math.max(1, Math.round(t.persistence_days)))
          : 1,
      is_new: Boolean(t.is_new),
      model_used: PREMARKET_CLAUDE_MODEL,
    });
  }

  if (normalized.length < 8) {
    return { ok: false, error: `Too few valid themes parsed (${normalized.length})` };
  }

  const { error: delErr } = await supabase.from("daily_themes").delete().eq("theme_date", ymd);
  if (delErr) {
    return { ok: false, error: delErr.message };
  }

  const insertPayload = normalized.map((r) => ({
    ...r,
    generated_at: new Date().toISOString(),
  }));

  const { error: insErr } = await supabase.from("daily_themes").insert(insertPayload);
  if (insErr) {
    return { ok: false, error: insErr.message };
  }

  return { ok: true, themeDate: ymd, themeCount: insertPayload.length };
}
