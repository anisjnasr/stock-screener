/**
 * Screener filter field definitions for the New Screener modal.
 * Numeric/percentage/percentile: min and max inputs with optional formatting.
 * Categorical: dropdown. pctOperatorRow: operator + value for percentage fields.
 */

export type FilterField =
  | { key: string; label: string; type: "numeric"; minKey?: string; maxKey?: string; placeholder?: string; format?: "number" }
  | { key: string; label: string; type: "pct"; minKey?: string; maxKey?: string; placeholder?: string }
  | { key: string; label: string; type: "percentile"; minKey?: string; maxKey?: string; placeholder?: string }
  | { key: string; label: string; type: "categorical"; options: { value: string; label: string }[] }
  | { key: string; label: string; type: "text"; placeholder?: string }
  | { key: string; label: string; type: "pctOperatorRow"; minKey: string; maxKey: string }
  | {
      key: string;
      label: string;
      type: "includeExcludeMulti";
      options: { value: string; label: string }[];
      includeKey: string;
      excludeKey: string;
    }
  | { key: string; label: string; type: "dateRange"; fromKey: string; toKey: string }
  | { key: string; label: string; type: "sectionHeading" }
  | { key: string; label: string; type: "universeSelect" };

export type FilterCategory = { id: string; title: string; fields: FilterField[]; defaultCollapsed?: boolean };

/** Common GICS industries for dropdown */
const INDUSTRY_OPTIONS = [
  { value: "", label: "Any" },
  { value: "Aerospace & Defense", label: "Aerospace & Defense" },
  { value: "Airlines", label: "Airlines" },
  { value: "Aluminum", label: "Aluminum" },
  { value: "Apparel Manufacturing", label: "Apparel Manufacturing" },
  { value: "Asset Management", label: "Asset Management" },
  { value: "Auto Manufacturers", label: "Auto Manufacturers" },
  { value: "Banks", label: "Banks" },
  { value: "Beverages", label: "Beverages" },
  { value: "Biotechnology", label: "Biotechnology" },
  { value: "Building Materials", label: "Building Materials" },
  { value: "Banks - Regional", label: "Banks - Regional" },
  { value: "Communication Equipment", label: "Communication Equipment" },
  { value: "Computer Hardware", label: "Computer Hardware" },
  { value: "Consumer Electronics", label: "Consumer Electronics" },
  { value: "Diagnostics & Research", label: "Diagnostics & Research" },
  { value: "Drug Manufacturers", label: "Drug Manufacturers" },
  { value: "Education & Training Services", label: "Education & Training Services" },
  { value: "Electrical Equipment", label: "Electrical Equipment" },
  { value: "Electronic Components", label: "Electronic Components" },
  { value: "Entertainment", label: "Entertainment" },
  { value: "Financial Data & Stock Exchanges", label: "Financial Data & Stock Exchanges" },
  { value: "Food Products", label: "Food Products" },
  { value: "Gambling", label: "Gambling" },
  { value: "Gold", label: "Gold" },
  { value: "Healthcare Plans", label: "Healthcare Plans" },
  { value: "Homebuilding & Construction", label: "Homebuilding & Construction" },
  { value: "Information Technology Services", label: "Information Technology Services" },
  { value: "Insurance", label: "Insurance" },
  { value: "Internet Content & Information", label: "Internet Content & Information" },
  { value: "Medical Devices", label: "Medical Devices" },
  { value: "Oil & Gas", label: "Oil & Gas" },
  { value: "Packaging & Containers", label: "Packaging & Containers" },
  { value: "Pharmaceutical Retailers", label: "Pharmaceutical Retailers" },
  { value: "Real Estate - Development", label: "Real Estate - Development" },
  { value: "Real Estate Services", label: "Real Estate Services" },
  { value: "REITs", label: "REITs" },
  { value: "Scientific & Technical Instruments", label: "Scientific & Technical Instruments" },
  { value: "Semiconductors", label: "Semiconductors" },
  { value: "Shell Companies", label: "Shell Companies" },
  { value: "Software", label: "Software" },
  { value: "Specialty Retail", label: "Specialty Retail" },
  { value: "Staffing & Employment Services", label: "Staffing & Employment Services" },
  { value: "Steel", label: "Steel" },
  { value: "Telecom Services", label: "Telecom Services" },
  { value: "Travel Services", label: "Travel Services" },
  { value: "Utilities", label: "Utilities" },
];

export const PCT_OPERATORS: { value: string; label: string }[] = [
  { value: "gte", label: "Greater than or equal to" },
  { value: "gt", label: "Greater than" },
  { value: "lte", label: "Less than or equal to" },
  { value: "lt", label: "Less than" },
  { value: "eq", label: "Equal to" },
];

/** GICS sectors for Include/Exclude multi-select, sorted alphabetically */
const SECTOR_OPTIONS = [
  { value: "Basic Materials", label: "Basic Materials" },
  { value: "Communication Services", label: "Communication Services" },
  { value: "Consumer Cyclical", label: "Consumer Cyclical" },
  { value: "Consumer Defensive", label: "Consumer Defensive" },
  { value: "Energy", label: "Energy" },
  { value: "Financial Services", label: "Financial Services" },
  { value: "Healthcare", label: "Healthcare" },
  { value: "Industrials", label: "Industrials" },
  { value: "Real Estate", label: "Real Estate" },
  { value: "Technology", label: "Technology" },
  { value: "Utilities", label: "Utilities" },
];

/** Industries for Include/Exclude multi-select (exclude "Any" option), sorted alphabetically */
const INDUSTRY_GROUP_OPTIONS = INDUSTRY_OPTIONS.filter((o) => o.value !== "").sort((a, b) =>
  a.label.localeCompare(b.label)
);

export const SCREENER_FILTER_CATEGORIES: FilterCategory[] = [
  {
    id: "general",
    title: "General",
    defaultCollapsed: true,
    fields: [
      { key: "is_adr", label: "ADR", type: "categorical", options: [{ value: "", label: "Any" }, { value: "1", label: "Yes" }, { value: "0", label: "No" }] },
      { key: "is_etf", label: "ETF", type: "categorical", options: [{ value: "", label: "Any" }, { value: "1", label: "Yes" }, { value: "0", label: "No" }] },
      { key: "ipo_date", label: "IPO Date", type: "dateRange", fromKey: "ipo_date_from", toKey: "ipo_date_to" },
      { key: "market_cap", label: "Market Capitalization", type: "numeric", minKey: "market_cap_min", maxKey: "market_cap_max", format: "number" },
      { key: "shares_outstanding", label: "Shares Outstanding", type: "numeric", minKey: "shares_outstanding_min", maxKey: "shares_outstanding_max", format: "number" },
      { key: "universe", label: "Universe", type: "universeSelect" },
    ],
  },
  {
    id: "industry-sector",
    title: "Industry & Sector",
    defaultCollapsed: true,
    fields: [
      {
        key: "industry_filter",
        label: "Industry Group",
        type: "includeExcludeMulti",
        options: INDUSTRY_GROUP_OPTIONS,
        includeKey: "industry_include",
        excludeKey: "industry_exclude",
      },
      {
        key: "sector_filter",
        label: "Broad Sectors",
        type: "includeExcludeMulti",
        options: SECTOR_OPTIONS,
        includeKey: "sector_include",
        excludeKey: "sector_exclude",
      },
    ],
  },
  {
    id: "earnings",
    title: "Earnings",
    defaultCollapsed: true,
    fields: [
      { key: "earnings_heading_general", label: "General", type: "sectionHeading" },
      { key: "earnings_last_reported", label: "Earnings Last Reported Date", type: "dateRange", fromKey: "earnings_last_reported_from", toKey: "earnings_last_reported_to" },
      { key: "earnings_heading_quarterly", label: "Quarterly", type: "sectionHeading" },
      { key: "eps_recent_q", label: "EPS (recent quarter)", type: "numeric", minKey: "eps_recent_q_min", maxKey: "eps_recent_q_max", format: "number" },
      { key: "avg_eps_2q", label: "Avg EPS (last 2 quarters)", type: "numeric", minKey: "avg_eps_2q_min", maxKey: "avg_eps_2q_max", format: "number" },
      { key: "eps_growth_recent_q", label: "EPS Growth (last quarter)", type: "pct", minKey: "eps_growth_recent_q_min", maxKey: "eps_growth_recent_q_max" },
      { key: "avg_eps_growth_2q", label: "Avg EPS Growth (last 2 quarters)", type: "pct", minKey: "avg_eps_growth_2q_min", maxKey: "avg_eps_growth_2q_max" },
      { key: "avg_eps_growth_3q", label: "Avg EPS Growth (last 3 quarters)", type: "pct", minKey: "avg_eps_growth_3q_min", maxKey: "avg_eps_growth_3q_max" },
      { key: "avg_eps_growth_4q", label: "Avg EPS Growth (last 4 quarters)", type: "pct", minKey: "avg_eps_growth_4q_min", maxKey: "avg_eps_growth_4q_max" },
      { key: "earnings_heading_annual", label: "Annual", type: "sectionHeading" },
      { key: "eps_ttm", label: "EPS (trailing 12 months)", type: "numeric", minKey: "eps_ttm_min", maxKey: "eps_ttm_max", format: "number" },
      { key: "avg_eps_2y", label: "Avg EPS (last 2 years)", type: "numeric", minKey: "avg_eps_2y_min", maxKey: "avg_eps_2y_max", format: "number" },
      { key: "eps_growth_1y", label: "EPS Growth (last year)", type: "pct", minKey: "eps_growth_1y_min", maxKey: "eps_growth_1y_max" },
      { key: "eps_growth_2y_ago", label: "EPS Growth (2 yrs ago)", type: "pct", minKey: "eps_growth_2y_ago_min", maxKey: "eps_growth_2y_ago_max" },
      { key: "avg_eps_growth_2y", label: "Avg EPS Growth (last 2 years)", type: "pct", minKey: "avg_eps_growth_2y_min", maxKey: "avg_eps_growth_2y_max" },
      { key: "avg_eps_growth_3y", label: "Avg EPS Growth (last 3 years)", type: "pct", minKey: "avg_eps_growth_3y_min", maxKey: "avg_eps_growth_3y_max" },
    ],
  },
  {
    id: "sales",
    title: "Sales",
    defaultCollapsed: true,
    fields: [
      { key: "sales_heading_general", label: "General", type: "sectionHeading" },
      { key: "sales_last_reported", label: "Sales Last Reported Date", type: "dateRange", fromKey: "sales_last_reported_from", toKey: "sales_last_reported_to" },
      { key: "sales_heading_quarterly", label: "Quarterly", type: "sectionHeading" },
      { key: "sales_recent_q", label: "Sales (recent quarter)", type: "numeric", minKey: "sales_recent_q_min", maxKey: "sales_recent_q_max", format: "number" },
      { key: "avg_sales_2q", label: "Avg Sales (last 2 quarters)", type: "numeric", minKey: "avg_sales_2q_min", maxKey: "avg_sales_2q_max", format: "number" },
      { key: "sales_growth_recent_q", label: "Sales Growth (last quarter)", type: "pct", minKey: "sales_growth_recent_q_min", maxKey: "sales_growth_recent_q_max" },
      { key: "avg_sales_growth_2q", label: "Avg Sales Growth (last 2 quarters)", type: "pct", minKey: "avg_sales_growth_2q_min", maxKey: "avg_sales_growth_2q_max" },
      { key: "avg_sales_growth_3q", label: "Avg Sales Growth (last 3 quarters)", type: "pct", minKey: "avg_sales_growth_3q_min", maxKey: "avg_sales_growth_3q_max" },
      { key: "avg_sales_growth_4q", label: "Avg Sales Growth (last 4 quarters)", type: "pct", minKey: "avg_sales_growth_4q_min", maxKey: "avg_sales_growth_4q_max" },
      { key: "sales_heading_annual", label: "Annual", type: "sectionHeading" },
      { key: "sales_ttm", label: "Sales (trailing 12 months)", type: "numeric", minKey: "sales_ttm_min", maxKey: "sales_ttm_max", format: "number" },
      { key: "avg_sales_2y", label: "Avg Sales (last 2 years)", type: "numeric", minKey: "avg_sales_2y_min", maxKey: "avg_sales_2y_max", format: "number" },
      { key: "sales_growth_1y", label: "Sales Growth (last year)", type: "pct", minKey: "sales_growth_1y_min", maxKey: "sales_growth_1y_max" },
      { key: "sales_growth_2y_ago", label: "Sales Growth (2 yrs ago)", type: "pct", minKey: "sales_growth_2y_ago_min", maxKey: "sales_growth_2y_ago_max" },
      { key: "avg_sales_growth_2y", label: "Avg Sales Growth (last 2 years)", type: "pct", minKey: "avg_sales_growth_2y_min", maxKey: "avg_sales_growth_2y_max" },
      { key: "avg_sales_growth_3y", label: "Avg Sales Growth (last 3 years)", type: "pct", minKey: "avg_sales_growth_3y_min", maxKey: "avg_sales_growth_3y_max" },
    ],
  },
  {
    id: "fundamentals",
    title: "Fundamentals",
    defaultCollapsed: true,
    fields: [
      { key: "last_price", label: "Last Price", type: "numeric", minKey: "last_price_min", maxKey: "last_price_max", format: "number" },
      { key: "volume", label: "Volume", type: "numeric", minKey: "volume_min", maxKey: "volume_max", format: "number" },
      { key: "avg_volume_30d", label: "Avg Daily Volume (30d)", type: "numeric", minKey: "avg_volume_30d_min", maxKey: undefined, format: "number" },
      { key: "high_52w", label: "52 Week High", type: "numeric", minKey: "high_52w_min", maxKey: undefined, format: "number" },
      { key: "off_52w_high_pct_row", label: "Off 52W High %", type: "pctOperatorRow", minKey: "off_52w_high_pct_min", maxKey: "off_52w_high_pct_max" },
      { key: "atr_pct_21d_row", label: "ATR % (21d)", type: "pctOperatorRow", minKey: "atr_pct_21d_min", maxKey: "atr_pct_21d_max" },
      { key: "change_pct", label: "Change % (Today)", type: "pct", minKey: "change_pct_min", maxKey: "change_pct_max" },
      { key: "price_change_1w_pct", label: "Price Change % (1W)", type: "pct", minKey: "price_change_1w_pct_min", maxKey: "price_change_1w_pct_max" },
      { key: "price_change_1m_pct", label: "Price Change % (1M)", type: "pct", minKey: "price_change_1m_pct_min", maxKey: "price_change_1m_pct_max" },
      { key: "price_change_3m_pct", label: "Price Change % (3M)", type: "pct", minKey: "price_change_3m_pct_min", maxKey: "price_change_3m_pct_max" },
      { key: "price_change_6m_pct", label: "Price Change % (6M)", type: "pct", minKey: "price_change_6m_pct_min", maxKey: "price_change_6m_pct_max" },
      { key: "price_change_12m_pct", label: "Price Change % (12M)", type: "pct", minKey: "price_change_12m_pct_min", maxKey: "price_change_12m_pct_max" },
    ],
  },
  {
    id: "technicals",
    title: "Technicals",
    defaultCollapsed: true,
    fields: [
      { key: "rs_pct_1w", label: "RS (1W) Percentile", type: "percentile", minKey: "rs_pct_1w_min", maxKey: "rs_pct_1w_max" },
      { key: "rs_pct_1m", label: "RS (1M) Percentile", type: "percentile", minKey: "rs_pct_1m_min", maxKey: "rs_pct_1m_max" },
      { key: "rs_pct_3m", label: "RS (3M) Percentile", type: "percentile", minKey: "rs_pct_3m_min", maxKey: "rs_pct_3m_max" },
      { key: "rs_pct_6m", label: "RS (6M) Percentile", type: "percentile", minKey: "rs_pct_6m_min", maxKey: "rs_pct_6m_max" },
      { key: "rs_pct_12m", label: "RS (12M) Percentile", type: "percentile", minKey: "rs_pct_12m_min", maxKey: "rs_pct_12m_max" },
      { key: "industry_rank_1m", label: "Industry Rank 1M (1=best)", type: "numeric", minKey: "industry_rank_1m_min", maxKey: "industry_rank_1m_max", format: "number" },
      { key: "industry_rank_3m", label: "Industry Rank 3M (1=best)", type: "numeric", minKey: "industry_rank_3m_min", maxKey: "industry_rank_3m_max", format: "number" },
      { key: "industry_rank_6m", label: "Industry Rank 6M (1=best)", type: "numeric", minKey: "industry_rank_6m_min", maxKey: "industry_rank_6m_max", format: "number" },
      { key: "industry_rank_12m", label: "Industry Rank 12M (1=best)", type: "numeric", minKey: "industry_rank_12m_min", maxKey: "industry_rank_12m_max", format: "number" },
      { key: "sector_rank_1m", label: "Sector Rank 1M (1=best)", type: "numeric", minKey: "sector_rank_1m_min", maxKey: "sector_rank_1m_max", format: "number" },
      { key: "sector_rank_3m", label: "Sector Rank 3M (1=best)", type: "numeric", minKey: "sector_rank_3m_min", maxKey: "sector_rank_3m_max", format: "number" },
      { key: "sector_rank_6m", label: "Sector Rank 6M (1=best)", type: "numeric", minKey: "sector_rank_6m_min", maxKey: "sector_rank_6m_max", format: "number" },
      { key: "sector_rank_12m", label: "Sector Rank 12M (1=best)", type: "numeric", minKey: "sector_rank_12m_min", maxKey: "sector_rank_12m_max", format: "number" },
    ],
  },
];

import type { ColumnId } from "@/lib/watchlist-storage";
import { ALL_COLUMN_IDS } from "@/lib/watchlist-storage";
import type { ScreenerFilters } from "@/lib/screener-storage";

/** Map filter keys (as stored in screen.filters) to table ColumnId for criterion columns. */
const FILTER_KEY_TO_COLUMN_ID: Record<string, ColumnId> = {
  market_cap_min: "marketCap",
  market_cap_max: "marketCap",
  last_price_min: "lastPrice",
  last_price_max: "lastPrice",
  change_pct_min: "changePct",
  change_pct_max: "changePct",
  volume_min: "volume",
  volume_max: "volume",
  avg_volume_30d_min: "avgVolume",
  high_52w_min: "high52w",
  off_52w_high_pct_min: "off52wHighPct",
  off_52w_high_pct_max: "off52wHighPct",
  atr_pct_21d_min: "atrPct",
  atr_pct_21d_max: "atrPct",
  industry_include: "industry",
  industry_exclude: "industry",
  sector_include: "sector",
  sector_exclude: "sector",
  price_change_1w_pct_min: "priceChange1wPct",
  price_change_1w_pct_max: "priceChange1wPct",
  price_change_1m_pct_min: "priceChange1mPct",
  price_change_1m_pct_max: "priceChange1mPct",
  price_change_3m_pct_min: "priceChange3mPct",
  price_change_3m_pct_max: "priceChange3mPct",
  price_change_6m_pct_min: "priceChange6mPct",
  price_change_6m_pct_max: "priceChange6mPct",
  price_change_12m_pct_min: "priceChange12mPct",
  price_change_12m_pct_max: "priceChange12mPct",
  rs_pct_1w_min: "rsPct1w",
  rs_pct_1w_max: "rsPct1w",
  rs_pct_1m_min: "rsPct1m",
  rs_pct_1m_max: "rsPct1m",
  rs_pct_3m_min: "rsPct3m",
  rs_pct_3m_max: "rsPct3m",
  rs_pct_6m_min: "rsPct6m",
  rs_pct_6m_max: "rsPct6m",
  rs_pct_12m_min: "rsPct12m",
  rs_pct_12m_max: "rsPct12m",
  industry_rank_1m_min: "industryRank1m",
  industry_rank_1m_max: "industryRank1m",
  industry_rank_3m_min: "industryRank3m",
  industry_rank_3m_max: "industryRank3m",
  industry_rank_6m_min: "industryRank6m",
  industry_rank_6m_max: "industryRank6m",
  industry_rank_12m_min: "industryRank12m",
  industry_rank_12m_max: "industryRank12m",
  sector_rank_1m_min: "sectorRank1m",
  sector_rank_1m_max: "sectorRank1m",
  sector_rank_3m_min: "sectorRank3m",
  sector_rank_3m_max: "sectorRank3m",
  sector_rank_6m_min: "sectorRank6m",
  sector_rank_6m_max: "sectorRank6m",
  sector_rank_12m_min: "sectorRank12m",
  sector_rank_12m_max: "sectorRank12m",
};

/**
 * Return ColumnIds for table columns that correspond to active filter criteria (ticker and lastPrice not included).
 * Order follows ALL_COLUMN_IDS so column order is consistent.
 */
export function getFilterCriteriaColumns(filters: ScreenerFilters): ColumnId[] {
  const seen = new Set<ColumnId>();
  const result: ColumnId[] = [];
  for (const key of Object.keys(filters)) {
    const val = filters[key];
    if (val === undefined || val === "") continue;
    const col = FILTER_KEY_TO_COLUMN_ID[key];
    if (col && !seen.has(col) && ALL_COLUMN_IDS.includes(col)) {
      seen.add(col);
      result.push(col);
    }
  }
  return result.sort((a, b) => ALL_COLUMN_IDS.indexOf(a) - ALL_COLUMN_IDS.indexOf(b));
}
