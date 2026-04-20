import { addCalendarDaysYmd, ymdInEt } from "@/lib/et-ymd";
import { getSupabase } from "@/lib/supabase";

/**
 * Tickers that likely printed EPS/revenue in the last ~24h (ET heuristics for gapper badges).
 *
 * Includes: today’s session with actuals, plus yesterday AMC (typical post-close print).
 */
export async function getTickersWithEarningsInLast24Hours(): Promise<Set<string>> {
  const supabase = getSupabase();
  if (!supabase) return new Set();

  const today = ymdInEt();
  const yesterday = addCalendarDaysYmd(today, -1);

  const { data, error } = await supabase
    .from("earnings_calendar")
    .select("ticker, report_date, report_time, eps_actual, revenue_actual")
    .in("report_date", [yesterday, today])
    .or("eps_actual.not.is.null,revenue_actual.not.is.null");

  if (error) {
    console.warn("[earnings-recent]", error.message);
    return new Set();
  }

  const out = new Set<string>();
  for (const raw of data ?? []) {
    const r = raw as {
      ticker?: string;
      report_date?: string;
      report_time?: string | null;
    };
    const ticker = String(r.ticker ?? "").toUpperCase();
    const rd = String(r.report_date ?? "").slice(0, 10);
    if (!ticker || !rd) continue;

    if (rd === today) {
      out.add(ticker);
      continue;
    }
    if (rd === yesterday && r.report_time === "amc") {
      out.add(ticker);
    }
  }

  return out;
}
