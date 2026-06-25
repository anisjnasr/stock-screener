// COT panel — contract configuration and CFTC dataset IDs.
// Contract names + column spellings were confirmed in discovery (Task 1) and are
// identical across all three datasets. See scripts/cot-shared.mjs for the one-time
// backfill counterpart (kept in sync with the camp logic in ./ingest.ts).

export type ReportType = "tff" | "disagg";

export interface ContractConfig {
  key: string; // 'ES' | 'NQ' | 'RTY' | 'BTC' | 'GC' | 'CL'
  label: string; // UI pill label
  ticker: string; // ticker shown in the pill
  report: ReportType; // which primary report supplies comm/large-spec
  name: string; // CFTC contract_market_name (same across all three datasets)
}

export const SOCRATA_BASE = "https://publicreporting.cftc.gov/resource";

export const DATASET = {
  tff: "gpe5-46if", // Traders in Financial Futures, Futures-Only
  disagg: "72hh-3qpy", // Disaggregated, Futures-Only
  legacy: "6dca-aqww", // Legacy, Futures-Only (small-spec residual)
} as const;

export const CONTRACTS: ContractConfig[] = [
  { key: "ES", label: "S&P 500", ticker: "ES", report: "tff", name: "S&P 500 Consolidated" },
  { key: "NQ", label: "Nasdaq 100", ticker: "NQ", report: "tff", name: "NASDAQ-100 Consolidated" },
  { key: "RTY", label: "Russell 2000", ticker: "RTY", report: "tff", name: "RUSSELL E-MINI" },
  { key: "BTC", label: "Bitcoin", ticker: "BTC", report: "tff", name: "BITCOIN" },
  { key: "GC", label: "Gold", ticker: "GC", report: "disagg", name: "GOLD" },
  { key: "CL", label: "Crude oil", ticker: "CL", report: "disagg", name: "WTI-PHYSICAL" },
];

export interface CotWeeklyRow {
  report_date: string; // YYYY-MM-DD
  contract_key: string;
  report_type: ReportType;
  open_interest: number | null;
  comm_long: number | null;
  comm_short: number | null;
  large_spec_long: number | null;
  large_spec_short: number | null;
  small_spec_long: number | null;
  small_spec_short: number | null;
  updated_at: string;
}

// ---- Public read-API shapes (Task 5) ----

export interface CotSeriesPoint {
  date: string; // YYYY-MM-DD report date
  comm_net: number | null;
  large_spec_net: number | null;
  small_spec_net: number | null;
  spread: number | null; // large_spec_net - comm_net
  cot_index: number | null; // 0-100, 3-year (156-week) range of large_spec_net
  open_interest: number | null;
}

export interface CotContractData {
  label: string;
  ticker: string;
  report_type: ReportType;
  latest: CotSeriesPoint | null;
  series: CotSeriesPoint[];
}

export type CotResponse = Record<string, CotContractData>;
