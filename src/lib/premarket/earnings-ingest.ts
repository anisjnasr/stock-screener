import { upsertEarningsCalendar } from "@/lib/earnings-calendar-upsert";
import {
  enrichMissingCompanyNames,
  fetchFinnhubEarningsCalendarWindow,
  mapFinnhubToInserts,
  prevQuarter,
} from "@/lib/sources/finnhubEarnings";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EarningsCalendarInsert } from "@/types/earnings-calendar";

export async function loadBigNameTickerSet(supabase: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await supabase.from("big_name_universe").select("ticker");
  if (error) throw new Error(error.message);
  const set = new Set<string>();
  for (const r of data ?? []) {
    const t = String((r as { ticker?: string }).ticker ?? "").toUpperCase();
    if (t) set.add(t);
  }
  return set;
}

async function attachPriorQuarterSurprises(
  supabase: SupabaseClient,
  rows: EarningsCalendarInsert[]
): Promise<void> {
  const tickers = [...new Set(rows.map((r) => r.ticker))];
  if (!tickers.length) return;

  const { data, error } = await supabase
    .from("earnings_calendar")
    .select("ticker, quarter, year, current_quarter_eps_surprise_pct, current_quarter_rev_surprise_pct")
    .in("ticker", tickers)
    .limit(50_000);

  if (error) {
    console.warn("[earnings-ingest] prior quarter lookup:", error.message);
    return;
  }

  const map = new Map<string, { eps: number | null; rev: number | null }>();
  for (const d of data ?? []) {
    const row = d as {
      ticker: string;
      quarter: number | null;
      year: number | null;
      current_quarter_eps_surprise_pct: number | null;
      current_quarter_rev_surprise_pct: number | null;
    };
    if (row.quarter == null || row.year == null) continue;
    const k = `${String(row.ticker).toUpperCase()}:${row.year}:${row.quarter}`;
    map.set(k, {
      eps: row.current_quarter_eps_surprise_pct,
      rev: row.current_quarter_rev_surprise_pct,
    });
  }

  for (const r of rows) {
    if (r.quarter == null || r.year == null) continue;
    const p = prevQuarter(r.quarter, r.year);
    const hit = map.get(`${r.ticker}:${p.year}:${p.quarter}`);
    if (hit) {
      r.prior_quarter_eps_surprise_pct = hit.eps;
      r.prior_quarter_rev_surprise_pct = hit.rev;
    }
  }
}

/**
 * Fetch Finnhub earnings for [fromYmd, toYmd], filter to `big_name_universe`, upsert.
 */
export async function ingestEarningsForWindow(
  supabase: SupabaseClient,
  fromYmd: string,
  toYmd: string,
  init?: { signal?: AbortSignal }
): Promise<{ upserted: number; errors: string[]; parsed: number }> {
  const allowed = await loadBigNameTickerSet(supabase);
  if (allowed.size === 0) {
    return { upserted: 0, errors: ["big_name_universe is empty — run POST /api/cron/earnings/universe first"], parsed: 0 };
  }

  const raw = await fetchFinnhubEarningsCalendarWindow(fromYmd, toYmd, { signal: init?.signal });
  const rows = mapFinnhubToInserts(raw, allowed);
  await enrichMissingCompanyNames(rows, { signal: init?.signal });
  await attachPriorQuarterSurprises(supabase, rows);
  const { upserted, errors } = await upsertEarningsCalendar(supabase, rows);
  return { upserted, errors, parsed: rows.length };
}
