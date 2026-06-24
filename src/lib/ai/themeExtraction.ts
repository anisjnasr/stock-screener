import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseModelJson, PREMARKET_CLAUDE_MODEL, streamClaudeText } from "@/lib/ai/claudeStream";
import { addCalendarDaysYmd } from "@/lib/et-ymd";
import { fetchCurrentNewsletterArchive, formatNewsletterArchivePromptBlock } from "@/lib/premarket/currentNewsletterArchive";
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
 * Builds `daily_themes` from the current newsletter archive, prior themes, and pre-market gappers.
 */
export async function generateAndStoreDailyThemes(
  supabase: SupabaseClient,
  anthropic: Anthropic,
  opts: { ymd: string }
): Promise<ThemeExtractionResult> {
  const { ymd } = opts;

  const currentArchive = await fetchCurrentNewsletterArchive(supabase);
  if (!currentArchive.ok) return { ok: false, error: currentArchive.error };
  const newsletterBlock = formatNewsletterArchivePromptBlock(currentArchive.rows);

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
    "Produce **up to 8 major macro/news bullets** and **5 industry themes** that best explain the current US trading context.",
    "",
    "Inputs:",
    "",
    "### Current newsletter archive",
    newsletterBlock,
    "",
    "### Yesterday's market context (continuity / persistence)",
    priorBlock,
    "",
    "### Pre-market gappers (sector hints)",
    gapperBlock,
    "",
    "Rules:",
    "- macro rows are major news bullets: rank 1–8 by market importance; include 3–8 only, depending on news density.",
    "- macro theme_title: concise news headline, max 90 chars.",
    "- macro theme_description: one concise sentence, specific, with the likely market relevance if clear.",
    "- macro rows must be concrete news/events from the archive: data releases, central-bank commentary, yields/rates, commodities, geopolitics, major index moves, or globally important earnings.",
    "- macro rows must not be vague regime labels like \"risk-on sentiment\", \"growth concerns\", or \"AI momentum\" unless tied to a specific news event.",
    "- macro rows should not be driven by pre-market gappers unless the move reflects a broad market or macro event.",
    "- macro rows: set industry to null and exemplar_tickers to an empty array.",
    "- industry rows are tradable sector/ticker themes: rank 1–5.",
    "- industry theme_title: short headline.",
    "- industry theme_description: 2–4 sentences, causal, specific.",
    "- asset_implications: how equities/sector ETFs might lean; use null if not useful for a macro news bullet.",
    "- key_watch: what would confirm or break the item today; use null if not useful for a macro news bullet.",
    "- industry themes: set industry to a concise sector label; exemplar_tickers: 2–5 US tickers if inferable.",
    "- trigger_signals: 2–4 short phrases.",
    "- persistence_days: integer 1–5 (estimate carry vs one-off).",
    "- is_new: true if not a clear continuation of yesterday's same theme title.",
    "",
    "Output **only** valid JSON:",
    '{"themes":[{"theme_type":"macro","theme_rank":1,"theme_title":"","theme_description":"","asset_implications":"","key_watch":"","industry":null,"exemplar_tickers":[],"trigger_signals":[],"persistence_days":1,"is_new":true}]}',
    "Include 3–8 macro objects and exactly 5 industry objects.",
  ].join("\n");

  const requestThemesRaw = async (isRetry: boolean): Promise<string> => {
    const retrySuffix = isRetry
      ? "\n\nYour previous response was invalid JSON. Return one JSON object only with a top-level 'themes' array and no extra text."
      : "";
    return streamClaudeText(anthropic, {
      system:
        "You summarize market-moving news and identify tradable industry themes for professional traders. Output strict JSON only — object with key \"themes\" array. No markdown.",
      user: `${user}${retrySuffix}`,
      maxTokens: 3400,
    });
  };

  let themesRaw: unknown[] | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    let raw: string;
    try {
      raw = await requestThemesRaw(attempt > 0);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Theme model failed" };
    }

    let parsed: unknown;
    try {
      parsed = parseModelJson<unknown>(raw);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "parse error";
      console.warn(`[theme-extraction] parse attempt ${attempt + 1} failed: ${msg}`);
      continue;
    }

    // Accept {"themes":[...]} wrapper or a bare array.
    if (Array.isArray(parsed)) {
      themesRaw = parsed;
      break;
    }
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).themes)) {
      themesRaw = (parsed as Record<string, unknown>).themes as unknown[];
      break;
    }

    console.warn(`[theme-extraction] attempt ${attempt + 1} returned unexpected JSON shape`);
  }

  if (!themesRaw) {
    return { ok: false, error: "Theme model returned non-JSON or unexpected structure" };
  }

  const MACRO_MAX_RANK = 8;
  const INDUSTRY_MAX_RANK = 5;

  const drafts = themesRaw as ThemeDraft[];

  // Collect valid macro and industry rows separately, sorted by the model's rank hint.
  // We re-rank them sequentially (1, 2, 3…) before insertion so the DB rank always
  // matches the actual position and is never out of range, regardless of what the model
  // returned (gaps, duplicates, out-of-range values).
  const macroRows: Omit<DailyThemeRow, "id" | "generated_at" | "theme_rank">[] = [];
  const industryRows: Omit<DailyThemeRow, "id" | "generated_at" | "theme_rank">[] = [];
  const macroRankHints: number[] = [];
  const industryRankHints: number[] = [];

  for (const t of drafts) {
    const tt: "macro" | "industry" = t.theme_type === "industry" ? "industry" : "macro";
    const title = String(t.theme_title ?? "").trim();
    const desc = String(t.theme_description ?? "").trim();
    if (!title || !desc) continue;
    const rankHint = Number.isFinite(Number(t.theme_rank)) ? Number(t.theme_rank) : 99;
    const row = {
      theme_date: ymd,
      theme_type: tt,
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
    };
    if (tt === "macro") {
      macroRows.push(row);
      macroRankHints.push(rankHint);
    } else {
      industryRows.push(row);
      industryRankHints.push(rankHint);
    }
  }

  // Sort by rank hint then re-rank sequentially, capped at the DB constraint maximum.
  const sortedMacro = macroRows
    .map((r, i) => ({ r, hint: macroRankHints[i] }))
    .sort((a, b) => a.hint - b.hint)
    .slice(0, MACRO_MAX_RANK)
    .map((x, i) => ({ ...x.r, theme_rank: i + 1 }));

  const sortedIndustry = industryRows
    .map((r, i) => ({ r, hint: industryRankHints[i] }))
    .sort((a, b) => a.hint - b.hint)
    .slice(0, INDUSTRY_MAX_RANK)
    .map((x, i) => ({ ...x.r, theme_rank: i + 1 }));

  const normalized = [...sortedMacro, ...sortedIndustry];

  const macroCount = sortedMacro.length;
  const industryCount = sortedIndustry.length;

  if (macroCount < 3 || industryCount < 3) {
    return { ok: false, error: `Too few valid themes parsed (${macroCount} macro, ${industryCount} industry)` };
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
