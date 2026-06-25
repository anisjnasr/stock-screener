// COT ingest — fetch CFTC Socrata data, collapse into three camps, upsert cot_weekly.
// Canonical runtime implementation (used by the weekly refresh cron, Task 4).
//
// Column quirks confirmed in discovery (Task 1):
//   * Disaggregated swap-SHORT is `swap__positions_short_all` (DOUBLE underscore);
//     swap-LONG is `swap_positions_long_all` (single underscore).
//   * Disaggregated other-reportables are `other_rept_positions_long/short` (no `_all`).
//   * Main WTI crude is contract_market_name "WTI-PHYSICAL" (no "CRUDE" in the name).

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CONTRACTS,
  DATASET,
  SOCRATA_BASE,
  type ContractConfig,
  type CotWeeklyRow,
  type ReportType,
} from "./contracts";

type SocrataRow = Record<string, string | undefined>;

function num(v: string | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Sum components; missing parts count as 0, but returns null if every part is missing.
function sum(...vals: (string | undefined)[]): number | null {
  const nums = vals.map(num).filter((n): n is number => n !== null);
  return nums.length ? nums.reduce((a, b) => a + b, 0) : null;
}

function ymd(s: string | undefined): string | null {
  return typeof s === "string" ? s.slice(0, 10) : null;
}

async function fetchRows(
  datasetId: string,
  contractName: string,
  sinceYmd: string,
  token: string | undefined,
  signal?: AbortSignal
): Promise<SocrataRow[]> {
  const where =
    `contract_market_name='${contractName.replace(/'/g, "''")}' ` +
    `AND report_date_as_yyyy_mm_dd > '${sinceYmd}'`;
  const url =
    `${SOCRATA_BASE}/${datasetId}.json` +
    `?$where=${encodeURIComponent(where)}` +
    `&$order=${encodeURIComponent("report_date_as_yyyy_mm_dd ASC")}` +
    `&$limit=5000`;
  const res = await fetch(url, {
    headers: token ? { "X-App-Token": token } : {},
    signal,
  });
  if (!res.ok) {
    throw new Error(`CFTC HTTP ${res.status} for ${datasetId} (${contractName})`);
  }
  return res.json() as Promise<SocrataRow[]>;
}

function primaryCamps(report: ReportType, row: SocrataRow) {
  if (report === "tff") {
    return {
      open_interest: num(row.open_interest_all),
      comm_long: num(row.dealer_positions_long_all),
      comm_short: num(row.dealer_positions_short_all),
      large_spec_long: sum(
        row.asset_mgr_positions_long,
        row.lev_money_positions_long,
        row.other_rept_positions_long
      ),
      large_spec_short: sum(
        row.asset_mgr_positions_short,
        row.lev_money_positions_short,
        row.other_rept_positions_short
      ),
    };
  }
  return {
    open_interest: num(row.open_interest_all),
    comm_long: sum(row.prod_merc_positions_long, row.swap_positions_long_all),
    comm_short: sum(
      row.prod_merc_positions_short,
      row.swap__positions_short_all ?? row.swap_positions_short_all
    ),
    large_spec_long: sum(row.m_money_positions_long_all, row.other_rept_positions_long),
    large_spec_short: sum(row.m_money_positions_short_all, row.other_rept_positions_short),
  };
}

/** Fetch + join all three datasets for one contract since `sinceYmd`. */
export async function buildContractRows(
  contract: ContractConfig,
  sinceYmd: string,
  token: string | undefined,
  signal?: AbortSignal
): Promise<CotWeeklyRow[]> {
  const [primaryRows, legacyRows] = await Promise.all([
    fetchRows(DATASET[contract.report], contract.name, sinceYmd, token, signal),
    fetchRows(DATASET.legacy, contract.name, sinceYmd, token, signal),
  ]);

  const legacyByDate = new Map<string, SocrataRow>();
  for (const r of legacyRows) {
    const date = ymd(r.report_date_as_yyyy_mm_dd);
    if (date) legacyByDate.set(date, r);
  }

  const now = new Date().toISOString();
  const rows: CotWeeklyRow[] = [];
  for (const pr of primaryRows) {
    const date = ymd(pr.report_date_as_yyyy_mm_dd);
    if (!date) continue;
    const camps = primaryCamps(contract.report, pr);
    const legacy = legacyByDate.get(date);
    rows.push({
      report_date: date,
      contract_key: contract.key,
      report_type: contract.report,
      open_interest: camps.open_interest,
      comm_long: camps.comm_long,
      comm_short: camps.comm_short,
      large_spec_long: camps.large_spec_long,
      large_spec_short: camps.large_spec_short,
      small_spec_long: legacy ? num(legacy.nonrept_positions_long_all) : null,
      small_spec_short: legacy ? num(legacy.nonrept_positions_short_all) : null,
      updated_at: now,
    });
  }
  return rows;
}

export interface RefreshResult {
  contract: string;
  weeks: number;
  latest: string | null;
  error?: string;
}

/**
 * Refresh all contracts since `sinceYmd` and upsert into `cot_weekly`.
 * Idempotent thanks to the unique (contract_key, report_date) constraint.
 */
export async function refreshCotWeekly(
  supabase: SupabaseClient,
  sinceYmd: string,
  token: string | undefined,
  signal?: AbortSignal
): Promise<{ results: RefreshResult[]; totalUpserted: number }> {
  const CHUNK = 200;
  const results: RefreshResult[] = [];
  let totalUpserted = 0;

  for (const contract of CONTRACTS) {
    try {
      const rows = await buildContractRows(contract, sinceYmd, token, signal);
      if (!rows.length) {
        results.push({ contract: contract.key, weeks: 0, latest: null });
        continue;
      }
      for (let i = 0; i < rows.length; i += CHUNK) {
        const slice = rows.slice(i, i + CHUNK);
        const { error } = await supabase
          .from("cot_weekly")
          .upsert(slice, { onConflict: "contract_key,report_date" });
        if (error) throw new Error(error.message);
        totalUpserted += slice.length;
      }
      results.push({
        contract: contract.key,
        weeks: rows.length,
        latest: rows[rows.length - 1].report_date,
      });
    } catch (e) {
      results.push({
        contract: contract.key,
        weeks: 0,
        latest: null,
        error: e instanceof Error ? e.message : "Unknown error",
      });
    }
  }

  return { results, totalUpserted };
}
