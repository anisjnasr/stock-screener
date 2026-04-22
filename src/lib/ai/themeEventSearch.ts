import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseModelJson, streamClaudeText } from "@/lib/ai/claudeStream";
import { addCalendarDaysYmd } from "@/lib/et-ymd";
import { upsertMarketEvents } from "@/lib/market-events-upsert";
import { fetchDailyThemesForDate } from "@/lib/premarket/dailyThemesRead";
import type { DailyThemeRow } from "@/types/daily-themes";
import type { MarketEventInsert, MarketImpact } from "@/types/market-events";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function dedupeKey(ymd: string, title: string): string {
  return `${ymd}|${title.toLowerCase().replace(/\s+/g, " ").trim()}`;
}

function parseImpact(raw: unknown): MarketImpact {
  const s = String(raw ?? "").trim();
  if (s === "High" || s === "Low" || s === "Medium") return s;
  return "Medium";
}

async function loadExistingDedupeKeys(
  supabase: SupabaseClient,
  from: string,
  to: string
): Promise<Set<string>> {
  const keys = new Set<string>();

  const [{ data: econ, error: eE }, { data: mkt, error: mE }] = await Promise.all([
    supabase.from("economic_events").select("event_date,event_name").gte("event_date", from).lte("event_date", to),
    supabase
      .from("market_events")
      .select("event_date,event_title,event_category")
      .gte("event_date", from)
      .lte("event_date", to)
      .neq("event_category", "theme_driven"),
  ]);

  if (!eE && econ) {
    for (const row of econ as { event_date: string; event_name: string }[]) {
      keys.add(dedupeKey(row.event_date, row.event_name));
    }
  }
  if (!mE && mkt) {
    for (const row of mkt as { event_date: string; event_title: string }[]) {
      keys.add(dedupeKey(row.event_date, row.event_title));
    }
  }

  return keys;
}

async function eventsForTheme(
  anthropic: Anthropic,
  theme: DailyThemeRow,
  window: { from: string; to: string }
): Promise<MarketEventInsert[]> {
  const user = [
    "Find **scheduled or widely telegraphed** US market-relevant events in the next two weeks that relate to this theme.",
    "Use web_search for verification. Prefer official schedules (government, company IR, exchange) when possible.",
    "",
    "Theme:",
    `- Type: ${theme.theme_type} (rank ${theme.theme_rank})`,
    `- Title: ${theme.theme_title}`,
    `- Description: ${theme.theme_description}`,
    theme.key_watch ? `- Watch: ${theme.key_watch}` : "",
    "",
    `Only include events with event_date between ${window.from} and ${window.to} inclusive (YYYY-MM-DD).`,
    "Max **4** events. Skip vague narratives; each row needs a concrete title and date.",
    "",
    "Output **only** valid JSON:",
    '{"events":[{"event_date":"YYYY-MM-DD","event_time_et":"HH:MM" or null,"event_title":"","impact":"High"|"Medium"|"Low","description":"","source_url":""}]}',
  ]
    .filter(Boolean)
    .join("\n");

  const raw = await streamClaudeText(anthropic, {
    system:
      "You discover real scheduled events. Output strict JSON only. If nothing credible exists, return {\"events\":[]}.",
    user,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }],
    toolChoice: { type: "auto" },
    maxTokens: 2500,
  });

  let parsed: { events?: unknown };
  try {
    parsed = parseModelJson<{ events?: unknown }>(raw);
  } catch {
    return [];
  }

  const list = parsed.events;
  if (!Array.isArray(list)) return [];

  const nowIso = new Date().toISOString();
  const out: MarketEventInsert[] = [];

  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const d = String(o.event_date ?? "").trim();
    const title = String(o.event_title ?? "").trim();
    if (!YMD.test(d) || !title) continue;
    if (d < window.from || d > window.to) continue;

    const tRaw = o.event_time_et;
    let event_time_et: string | null = null;
    if (tRaw != null && String(tRaw).trim() !== "") {
      const t = String(tRaw).trim();
      if (/^\d{1,2}:\d{2}$/.test(t)) {
        const [hh, mm] = t.split(":");
        event_time_et = `${String(Number(hh)).padStart(2, "0")}:${mm}:00`;
      }
    }

    const description = o.description != null ? String(o.description).trim() || null : null;
    let source_url = o.source_url != null ? String(o.source_url).trim() || null : null;
    if (source_url && !/^https?:\/\//i.test(source_url)) source_url = null;

    out.push({
      event_date: d,
      event_time_et,
      event_title: title,
      event_category: "theme_driven",
      speaker: null,
      location: null,
      impact: parseImpact(o.impact),
      source_url,
      source_type: "theme_web_search",
      external_id: null,
      description,
      updated_at: nowIso,
      theme_tag: theme.theme_title,
      theme_type: theme.theme_type,
      theme_rank: theme.theme_rank,
    });
    if (out.length >= 4) break;
  }

  return out;
}

export type ThemeEventSearchResult =
  | { ok: true; ymd: string; upserted: number; skippedDupes: number; themesProcessed: number }
  | { ok: false; error: string };

/**
 * For each `daily_themes` row on `ymd`, searches the web and upserts `market_events` with category `theme_driven`.
 * Dedupes against `economic_events` and non–theme-driven `market_events` on normalized (date, title).
 */
export async function discoverAndStoreThemeMarketEvents(
  supabase: SupabaseClient,
  anthropic: Anthropic,
  opts: { ymd: string }
): Promise<ThemeEventSearchResult> {
  const { ymd } = opts;
  const themes = await fetchDailyThemesForDate(supabase, ymd);
  if (!themes.length) {
    return { ok: true, ymd, upserted: 0, skippedDupes: 0, themesProcessed: 0 };
  }

  const from = ymd;
  const to = addCalendarDaysYmd(ymd, 14);
  const seen = await loadExistingDedupeKeys(supabase, from, to);

  const toUpsert: MarketEventInsert[] = [];
  let skippedDupes = 0;

  for (const theme of themes) {
    let candidates: MarketEventInsert[];
    try {
      candidates = await eventsForTheme(anthropic, theme, { from, to });
    } catch (e) {
      console.warn("[themeEventSearch] theme failed", theme.theme_title, e);
      continue;
    }

    for (const row of candidates) {
      const k = dedupeKey(row.event_date, row.event_title);
      if (seen.has(k)) {
        skippedDupes += 1;
        continue;
      }
      seen.add(k);
      toUpsert.push(row);
    }
  }

  if (!toUpsert.length) {
    return { ok: true, ymd, upserted: 0, skippedDupes, themesProcessed: themes.length };
  }

  const { upserted, errors } = await upsertMarketEvents(supabase, toUpsert);
  if (errors.length) {
    console.warn("[themeEventSearch] upsert errors", errors);
  }

  return {
    ok: true,
    ymd,
    upserted,
    skippedDupes,
    themesProcessed: themes.length,
  };
}
