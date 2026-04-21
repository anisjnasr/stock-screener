import { NextResponse } from "next/server";
import { addCalendarDaysYmd, ymdInEt } from "@/lib/et-ymd";
import { attachPriorQuarterActuals } from "@/lib/premarket/earnings-calendar-prior";
import { getSupabase } from "@/lib/supabase";
import type { EarningsCalendarBucket, EarningsCalendarPublic, EarningsCalendarResponse } from "@/types/earnings-calendar";

const TIME_ORDER: Record<string, number> = { bmo: 0, dmh: 1, amc: 2 };

function sortBucket(rows: EarningsCalendarPublic[]): EarningsCalendarPublic[] {
  return [...rows].sort((a, b) => {
    const ta = a.report_time ?? "dmh";
    const tb = b.report_time ?? "dmh";
    const oa = TIME_ORDER[ta] ?? 1;
    const ob = TIME_ORDER[tb] ?? 1;
    if (oa !== ob) return oa - ob;
    return a.ticker.localeCompare(b.ticker);
  });
}

function rowToPublic(r: Record<string, unknown>): EarningsCalendarPublic {
  return {
    id: String(r.id ?? ""),
    ticker: String(r.ticker ?? "").toUpperCase(),
    company_name: r.company_name != null ? String(r.company_name) : null,
    report_date: String(r.report_date ?? "").slice(0, 10),
    report_time: r.report_time != null ? String(r.report_time) : null,
    quarter: r.quarter != null ? Number(r.quarter) : null,
    year: r.year != null ? Number(r.year) : null,
    eps_estimate: r.eps_estimate != null ? Number(r.eps_estimate) : null,
    revenue_estimate: r.revenue_estimate != null ? Number(r.revenue_estimate) : null,
    eps_actual: r.eps_actual != null ? Number(r.eps_actual) : null,
    revenue_actual: r.revenue_actual != null ? Number(r.revenue_actual) : null,
    prior_eps_actual: null,
    prior_revenue_actual: null,
    current_quarter_eps_surprise_pct:
      r.current_quarter_eps_surprise_pct != null ? Number(r.current_quarter_eps_surprise_pct) : null,
    current_quarter_rev_surprise_pct:
      r.current_quarter_rev_surprise_pct != null ? Number(r.current_quarter_rev_surprise_pct) : null,
    prior_quarter_eps_surprise_pct:
      r.prior_quarter_eps_surprise_pct != null ? Number(r.prior_quarter_eps_surprise_pct) : null,
    prior_quarter_rev_surprise_pct:
      r.prior_quarter_rev_surprise_pct != null ? Number(r.prior_quarter_rev_surprise_pct) : null,
  };
}

/**
 * Big-name earnings for ET yesterday / today / tomorrow (anon + RLS SELECT).
 */
export async function GET() {
  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  }

  const anchor = ymdInEt();
  const yesterday = addCalendarDaysYmd(anchor, -1);
  const tomorrow = addCalendarDaysYmd(anchor, 1);

  const { data, error } = await supabase
    .from("earnings_calendar")
    .select(
      "id, ticker, company_name, report_date, report_time, quarter, year, eps_estimate, revenue_estimate, eps_actual, revenue_actual, current_quarter_eps_surprise_pct, current_quarter_rev_surprise_pct, prior_quarter_eps_surprise_pct, prior_quarter_rev_surprise_pct"
    )
    .in("report_date", [yesterday, anchor, tomorrow])
    .order("ticker", { ascending: true });

  if (error) {
    console.error("[earnings-calendar]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const buckets: Record<EarningsCalendarBucket, EarningsCalendarPublic[]> = {
    yesterday: [],
    today: [],
    tomorrow: [],
  };

  for (const raw of data ?? []) {
    const row = rowToPublic(raw as Record<string, unknown>);
    if (!row.id || !row.ticker) continue;
    if (row.report_date === yesterday) buckets.yesterday.push(row);
    else if (row.report_date === anchor) buckets.today.push(row);
    else if (row.report_date === tomorrow) buckets.tomorrow.push(row);
  }

  const flat = [...buckets.yesterday, ...buckets.today, ...buckets.tomorrow];
  await attachPriorQuarterActuals(supabase, flat);

  buckets.yesterday = sortBucket(buckets.yesterday);
  buckets.today = sortBucket(buckets.today);
  buckets.tomorrow = sortBucket(buckets.tomorrow);

  const body: EarningsCalendarResponse = { anchor, buckets };

  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "private, max-age=0, s-maxage=120, stale-while-revalidate=300",
    },
  });
}
