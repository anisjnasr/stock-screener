import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { computeContractSeries } from "@/lib/cot/compute";
import { CONTRACTS, type CotResponse, type CotWeeklyRow } from "@/lib/cot/contracts";

export const runtime = "nodejs";

/**
 * COT positioning data for the panel (anon + RLS SELECT). Reads `cot_weekly` for all
 * six contracts oldest -> newest, computes net / spread / 3-year COT index per week,
 * and returns JSON grouped by contract key. Data changes weekly, so we cache for a day.
 */
export async function GET() {
  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  }

  const { data, error } = await supabase
    .from("cot_weekly")
    .select(
      "report_date, contract_key, report_type, open_interest, comm_long, comm_short, large_spec_long, large_spec_short, small_spec_long, small_spec_short, updated_at"
    )
    .order("report_date", { ascending: true });

  if (error) {
    console.error("[cot]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const byContract = new Map<string, CotWeeklyRow[]>();
  for (const raw of (data ?? []) as CotWeeklyRow[]) {
    const list = byContract.get(raw.contract_key) ?? [];
    list.push(raw);
    byContract.set(raw.contract_key, list);
  }

  const response: CotResponse = {};
  for (const contract of CONTRACTS) {
    const rows = byContract.get(contract.key) ?? [];
    const { series, latest } = computeContractSeries(rows);
    response[contract.key] = {
      label: contract.label,
      ticker: contract.ticker,
      report_type: contract.report,
      latest,
      series,
    };
  }

  return NextResponse.json(response, {
    headers: {
      "Cache-Control": "public, max-age=0, s-maxage=86400, stale-while-revalidate=43200",
    },
  });
}
