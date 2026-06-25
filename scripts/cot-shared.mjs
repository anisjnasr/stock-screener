// Shared COT ingest helpers (Task 3 backfill + Task 4 weekly refresh).
//
// Pulls CFTC Socrata data, collapses trader categories into three camps, and
// builds rows for the `cot_weekly` table. Contract names + column spellings were
// confirmed in discovery (Task 1). Notably:
//   * Disaggregated swap-SHORT column is `swap__positions_short_all` (DOUBLE underscore),
//     while swap-LONG is `swap_positions_long_all` (single). This is a real CFTC quirk.
//   * Disaggregated other-reportables are `other_rept_positions_long/short` (no `_all`).
//   * Main WTI crude is named "WTI-PHYSICAL" (the word "CRUDE" is not in its name).

export const SOCRATA_BASE = "https://publicreporting.cftc.gov/resource";

export const DATASET = {
  tff: "gpe5-46if", // Traders in Financial Futures, Futures-Only
  disagg: "72hh-3qpy", // Disaggregated, Futures-Only
  legacy: "6dca-aqww", // Legacy, Futures-Only (small-spec residual)
};

// contract_market_name strings are identical across all three datasets (verified Task 1).
export const CONTRACTS = [
  { key: "ES", label: "S&P 500", ticker: "ES", report: "tff", name: "S&P 500 Consolidated" },
  { key: "NQ", label: "Nasdaq 100", ticker: "NQ", report: "tff", name: "NASDAQ-100 Consolidated" },
  { key: "RTY", label: "Russell 2000", ticker: "RTY", report: "tff", name: "RUSSELL E-MINI" },
  { key: "BTC", label: "Bitcoin", ticker: "BTC", report: "tff", name: "BITCOIN" },
  { key: "GC", label: "Gold", ticker: "GC", report: "disagg", name: "GOLD" },
  { key: "CL", label: "Crude oil", ticker: "CL", report: "disagg", name: "WTI-PHYSICAL" },
];

const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Sum components; treats missing parts as 0 but returns null if every part is missing.
const sum = (...vals) => {
  const nums = vals.map(num).filter((n) => n !== null);
  return nums.length ? nums.reduce((a, b) => a + b, 0) : null;
};

const ymd = (s) => (typeof s === "string" ? s.slice(0, 10) : null);

async function fetchRows(datasetId, contractName, sinceYmd, token) {
  const where = `contract_market_name='${contractName.replace(/'/g, "''")}' AND report_date_as_yyyy_mm_dd > '${sinceYmd}'`;
  const url =
    `${SOCRATA_BASE}/${datasetId}.json` +
    `?$where=${encodeURIComponent(where)}` +
    `&$order=${encodeURIComponent("report_date_as_yyyy_mm_dd ASC")}` +
    `&$limit=5000`;
  const res = await fetch(url, { headers: token ? { "X-App-Token": token } : {} });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${datasetId} (${contractName})`);
  return res.json();
}

// Collapse a primary-report row (TFF or Disaggregated) into the commercial / large-spec camps.
function primaryCamps(report, row) {
  if (report === "tff") {
    return {
      open_interest: num(row.open_interest_all),
      comm_long: num(row.dealer_positions_long_all),
      comm_short: num(row.dealer_positions_short_all),
      large_spec_long: sum(row.asset_mgr_positions_long, row.lev_money_positions_long, row.other_rept_positions_long),
      large_spec_short: sum(row.asset_mgr_positions_short, row.lev_money_positions_short, row.other_rept_positions_short),
    };
  }
  // disagg
  return {
    open_interest: num(row.open_interest_all),
    comm_long: sum(row.prod_merc_positions_long, row.swap_positions_long_all),
    // swap short uses the double-underscore column; fall back to single just in case.
    comm_short: sum(row.prod_merc_positions_short, row.swap__positions_short_all ?? row.swap_positions_short_all),
    large_spec_long: sum(row.m_money_positions_long_all, row.other_rept_positions_long),
    large_spec_short: sum(row.m_money_positions_short_all, row.other_rept_positions_short),
  };
}

/**
 * Fetch + join all three datasets for one contract since `sinceYmd`, returning
 * upsert-ready `cot_weekly` rows keyed by (contract_key, report_date).
 */
export async function buildContractRows(contract, sinceYmd, token) {
  const primaryId = DATASET[contract.report];
  const [primaryRows, legacyRows] = await Promise.all([
    fetchRows(primaryId, contract.name, sinceYmd, token),
    fetchRows(DATASET.legacy, contract.name, sinceYmd, token),
  ]);

  const legacyByDate = new Map();
  for (const r of legacyRows) {
    const date = ymd(r.report_date_as_yyyy_mm_dd);
    if (date) legacyByDate.set(date, r);
  }

  const rows = [];
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
      updated_at: new Date().toISOString(),
    });
  }
  return rows;
}
