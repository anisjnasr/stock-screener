/**
 * Supabase access for the DD tables (server-only, service role).
 * dd_overrides: trader float/market-cap overrides (global per ticker).
 * dd_reports: phase-2 cache keyed (ticker, latest_filing_date).
 */

import { getSupabaseService } from "@/lib/supabase";
import { isSupabaseTableMissingError } from "@/lib/supabase-table-errors";
import type {
  DDInstrument,
  DDMetrics,
  DDNewsItem,
  DDOverhangBreakdown,
  DDOverride,
  DDReportStatus,
  DDVerdictResult,
} from "./types";

export const DD_SETUP_MESSAGE =
  "Database tables `dd_overrides` / `dd_reports` are missing. In Supabase → SQL Editor, run " +
  "`data/supabase-small-cap-dd.sql` from this repo, then reload.";

export type StoreOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; setupRequired: true }
  | { ok: false; setupRequired: false; error: string };

function classifyError<T>(message: string): StoreOutcome<T> {
  if (isSupabaseTableMissingError(message)) return { ok: false, setupRequired: true };
  return { ok: false, setupRequired: false, error: message };
}

export async function getOverride(ticker: string): Promise<StoreOutcome<DDOverride | null>> {
  const supabase = getSupabaseService();
  if (!supabase) return { ok: false, setupRequired: false, error: "Supabase service role not configured" };
  const { data, error } = await supabase
    .from("dd_overrides")
    .select("ticker,float_override,market_cap_override")
    .eq("ticker", ticker)
    .maybeSingle();
  if (error) return classifyError(error.message);
  if (!data) return { ok: true, data: null };
  return {
    ok: true,
    data: {
      ticker: data.ticker as string,
      float_override: (data.float_override as number | null) ?? null,
      market_cap_override: (data.market_cap_override as number | null) ?? null,
    },
  };
}

export async function upsertOverride(input: DDOverride): Promise<StoreOutcome<DDOverride>> {
  const supabase = getSupabaseService();
  if (!supabase) return { ok: false, setupRequired: false, error: "Supabase service role not configured" };
  const { data, error } = await supabase
    .from("dd_overrides")
    .upsert(
      {
        ticker: input.ticker,
        float_override: input.float_override,
        market_cap_override: input.market_cap_override,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "ticker" }
    )
    .select("ticker,float_override,market_cap_override")
    .single();
  if (error) return classifyError(error.message);
  return {
    ok: true,
    data: {
      ticker: data.ticker as string,
      float_override: (data.float_override as number | null) ?? null,
      market_cap_override: (data.market_cap_override as number | null) ?? null,
    },
  };
}

export type CachedDilution = {
  status: DDReportStatus;
  latest_filing_date: string;
  generated_at: string;
  metrics: DDMetrics | null;
  news: DDNewsItem[];
  instruments: DDInstrument[];
  overhang: DDOverhangBreakdown | null;
  notes: string[];
  verdict: DDVerdictResult | null;
};

export async function getCachedDilution(
  ticker: string,
  latestFilingDate: string
): Promise<StoreOutcome<CachedDilution | null>> {
  const supabase = getSupabaseService();
  if (!supabase) return { ok: false, setupRequired: false, error: "Supabase service role not configured" };
  const { data, error } = await supabase
    .from("dd_reports")
    .select(
      "status,latest_filing_date,generated_at,instruments,overhang_breakdown,notes,verdict,verdict_reason,raise_pressure,cash_need,float_risk,overhang_pct,news"
    )
    .eq("ticker", ticker)
    .eq("latest_filing_date", latestFilingDate)
    .maybeSingle();
  if (error) return classifyError(error.message);
  if (!data) return { ok: true, data: null };

  const verdict: DDVerdictResult | null = data.verdict
    ? {
        verdict: data.verdict as DDVerdictResult["verdict"],
        reason: (data.verdict_reason as string) ?? "",
        signals: {
          raise_pressure: (data.raise_pressure as DDVerdictResult["signals"]["raise_pressure"]) ?? "low",
          cash_need: (data.cash_need as DDVerdictResult["signals"]["cash_need"]) ?? "low",
          float_risk: (data.float_risk as DDVerdictResult["signals"]["float_risk"]) ?? "low",
          overhang_pct: (data.overhang_pct as number | null) ?? null,
        },
      }
    : null;

  return {
    ok: true,
    data: {
      status: data.status as DDReportStatus,
      latest_filing_date: data.latest_filing_date as string,
      generated_at: data.generated_at as string,
      metrics: null,
      news: (data.news as DDNewsItem[] | null) ?? [],
      instruments: (data.instruments as DDInstrument[] | null) ?? [],
      overhang: (data.overhang_breakdown as DDOverhangBreakdown | null) ?? null,
      notes: (data.notes as string[] | null) ?? [],
      verdict,
    },
  };
}

export type DilutionUpsert = {
  ticker: string;
  latest_filing_date: string;
  status: DDReportStatus;
  metrics: DDMetrics | null;
  news: DDNewsItem[];
  instruments: DDInstrument[];
  overhang: DDOverhangBreakdown | null;
  notes: string[];
  verdict: DDVerdictResult | null;
};

export async function upsertDilutionReport(input: DilutionUpsert): Promise<StoreOutcome<true>> {
  const supabase = getSupabaseService();
  if (!supabase) return { ok: false, setupRequired: false, error: "Supabase service role not configured" };
  const m = input.metrics;
  const row = {
    ticker: input.ticker,
    latest_filing_date: input.latest_filing_date,
    generated_at: new Date().toISOString(),
    status: input.status,
    price: m?.price ?? null,
    gap_pct: m?.gap_pct ?? null,
    market_cap: m?.market_cap ?? null,
    market_cap_source: m?.market_cap_source ?? null,
    float: m?.float ?? null,
    float_source: m?.float_source ?? null,
    short_interest: m?.short_interest ?? null,
    short_pct_float: m?.short_pct_float ?? null,
    short_interest_date: m?.short_interest_date ?? null,
    shares_outstanding: m?.shares_outstanding ?? null,
    cash_on_hand: m?.cash_on_hand ?? null,
    ttm_operating_cf: m?.ttm_operating_cf ?? null,
    monthly_burn: m?.monthly_burn ?? null,
    runway_months: m?.runway_months ?? null,
    cash_as_of_date: m?.cash_as_of_date ?? null,
    verdict: input.verdict?.verdict ?? null,
    verdict_reason: input.verdict?.reason ?? null,
    raise_pressure: input.verdict?.signals.raise_pressure ?? null,
    cash_need: input.verdict?.signals.cash_need ?? null,
    float_risk: input.verdict?.signals.float_risk ?? null,
    overhang_pct: input.overhang?.overhang_pct ?? null,
    fully_diluted_shares: input.overhang?.fully_diluted_shares ?? null,
    news: input.news,
    splits: m?.splits ?? null,
    instruments: input.instruments,
    overhang_breakdown: input.overhang,
    notes: input.notes,
  };
  const { error } = await supabase.from("dd_reports").upsert(row, { onConflict: "ticker,latest_filing_date" });
  if (error) return classifyError(error.message);
  return { ok: true, data: true };
}
