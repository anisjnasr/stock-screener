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
  | { key: string; label: string; type: "checkbox"; filterKey: string }
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
    id: "technicals",
    title: "Technicals",
    defaultCollapsed: true,
    fields: [
      { key: "last_price", label: "Last Price", type: "numeric", minKey: "last_price_min", maxKey: "last_price_max", format: "number" },
      { key: "volume", label: "Volume", type: "numeric", minKey: "volume_min", maxKey: "volume_max", format: "number" },
      { key: "avg_volume_30d", label: "Avg Daily Volume (30d)", type: "numeric", minKey: "avg_volume_30d_min", maxKey: undefined, format: "number" },
      { key: "high_52w", label: "52 Week High", type: "numeric", minKey: "high_52w_min", maxKey: undefined, format: "number" },
      {
        key: "off_52w_high_pct",
        label: "Off 52W High %",
        type: "pct",
        minKey: "off_52w_high_pct_min",
        maxKey: "off_52w_high_pct_max",
      },
      {
        key: "new_52w_high_chk",
        label: "New 52W High",
        type: "checkbox",
        filterKey: "new_52w_high",
      },
      {
        key: "atr_10x_above_ema50_chk",
        label: "10× ATR vs 50D (extension)",
        type: "checkbox",
        filterKey: "atr_10x_above_ema50",
      },
      {
        key: "atr_units_above_ema50",
        label: "ATR units above EMA 50",
        type: "numeric",
        minKey: "atr_units_above_ema50_min",
        maxKey: "atr_units_above_ema50_max",
        format: "number",
      },
      { key: "atr_pct_21d_row", label: "ATR % (21d)", type: "pctOperatorRow", minKey: "atr_pct_21d_min", maxKey: "atr_pct_21d_max" },
      { key: "pct_from_ema_20", label: "% distance vs EMA 20", type: "pct", minKey: "pct_from_ema_20_min", maxKey: "pct_from_ema_20_max" },
      { key: "pct_from_ema_50", label: "% distance vs EMA 50", type: "pct", minKey: "pct_from_ema_50_min", maxKey: "pct_from_ema_50_max" },
      { key: "pct_from_ema_100", label: "% distance vs EMA 100", type: "pct", minKey: "pct_from_ema_100_min", maxKey: "pct_from_ema_100_max" },
      { key: "pct_from_ema_200", label: "% distance vs EMA 200", type: "pct", minKey: "pct_from_ema_200_min", maxKey: "pct_from_ema_200_max" },
      {
        key: "above_ema_20",
        label: "Price vs EMA 20",
        type: "categorical",
        options: [
          { value: "", label: "Any" },
          { value: "1", label: "Above" },
          { value: "0", label: "At or below" },
        ],
      },
      {
        key: "above_ema_50",
        label: "Price vs EMA 50",
        type: "categorical",
        options: [
          { value: "", label: "Any" },
          { value: "1", label: "Above" },
          { value: "0", label: "At or below" },
        ],
      },
      {
        key: "above_ema_100",
        label: "Price vs EMA 100",
        type: "categorical",
        options: [
          { value: "", label: "Any" },
          { value: "1", label: "Above" },
          { value: "0", label: "At or below" },
        ],
      },
      {
        key: "above_ema_200",
        label: "Price vs EMA 200",
        type: "categorical",
        options: [
          { value: "", label: "Any" },
          { value: "1", label: "Above" },
          { value: "0", label: "At or below" },
        ],
      },
      {
        key: "ema_20_above_50",
        label: "EMA 20 vs EMA 50",
        type: "categorical",
        options: [
          { value: "", label: "Any" },
          { value: "1", label: "20 above 50" },
          { value: "0", label: "20 at or below 50" },
        ],
      },
      {
        key: "ema_50_above_100",
        label: "EMA 50 vs EMA 100",
        type: "categorical",
        options: [
          { value: "", label: "Any" },
          { value: "1", label: "50 above 100" },
          { value: "0", label: "50 at or below 100" },
        ],
      },
      {
        key: "ema_50_above_200",
        label: "EMA 50 vs EMA 200",
        type: "categorical",
        options: [
          { value: "", label: "Any" },
          { value: "1", label: "50 above 200" },
          { value: "0", label: "50 at or below 200" },
        ],
      },
      {
        key: "ema_100_above_200",
        label: "EMA 100 vs EMA 200",
        type: "categorical",
        options: [
          { value: "", label: "Any" },
          { value: "1", label: "100 above 200" },
          { value: "0", label: "100 at or below 200" },
        ],
      },
      {
        key: "ema_200_vs_lag_20",
        label: "EMA 200 vs same 20 sessions ago",
        type: "categorical",
        options: [
          { value: "", label: "Any" },
          { value: "above", label: "Current above lagged" },
          { value: "below", label: "Current below lagged" },
        ],
      },
      {
        key: "ema_200_vs_lag_30",
        label: "EMA 200 vs same 30 sessions ago",
        type: "categorical",
        options: [
          { value: "", label: "Any" },
          { value: "above", label: "Current above lagged" },
          { value: "below", label: "Current below lagged" },
        ],
      },
      {
        key: "ema_200_vs_lag_60",
        label: "EMA 200 vs same 60 sessions ago",
        type: "categorical",
        options: [
          { value: "", label: "Any" },
          { value: "above", label: "Current above lagged" },
          { value: "below", label: "Current below lagged" },
        ],
      },
      { key: "change_pct", label: "Change % (Today)", type: "pct", minKey: "change_pct_min", maxKey: "change_pct_max" },
      { key: "price_change_1w_pct", label: "Price Change % (1W)", type: "pct", minKey: "price_change_1w_pct_min", maxKey: "price_change_1w_pct_max" },
      { key: "price_change_1m_pct", label: "Price Change % (1M)", type: "pct", minKey: "price_change_1m_pct_min", maxKey: "price_change_1m_pct_max" },
      { key: "price_change_3m_pct", label: "Price Change % (3M)", type: "pct", minKey: "price_change_3m_pct_min", maxKey: "price_change_3m_pct_max" },
      { key: "price_change_6m_pct", label: "Price Change % (6M)", type: "pct", minKey: "price_change_6m_pct_min", maxKey: "price_change_6m_pct_max" },
      { key: "price_change_12m_pct", label: "Price Change % (12M)", type: "pct", minKey: "price_change_12m_pct_min", maxKey: "price_change_12m_pct_max" },
      { key: "rs_pct_1w", label: "RS (1W) Percentile", type: "percentile", minKey: "rs_pct_1w_min", maxKey: "rs_pct_1w_max" },
      { key: "rs_pct_1m", label: "RS (1M) Percentile", type: "percentile", minKey: "rs_pct_1m_min", maxKey: "rs_pct_1m_max" },
      { key: "rs_pct_3m", label: "RS (3M) Percentile", type: "percentile", minKey: "rs_pct_3m_min", maxKey: "rs_pct_3m_max" },
      { key: "rs_pct_6m", label: "RS (6M) Percentile", type: "percentile", minKey: "rs_pct_6m_min", maxKey: "rs_pct_6m_max" },
      { key: "rs_pct_12m", label: "RS (12M) Percentile", type: "percentile", minKey: "rs_pct_12m_min", maxKey: "rs_pct_12m_max" },
      { key: "industry_rank_1m", label: "Industry Leaderboard Rank 1M (1=best)", type: "numeric", minKey: "industry_rank_1m_min", maxKey: "industry_rank_1m_max", format: "number" },
      { key: "industry_rank_3m", label: "Industry Leaderboard Rank 3M (1=best)", type: "numeric", minKey: "industry_rank_3m_min", maxKey: "industry_rank_3m_max", format: "number" },
      { key: "industry_rank_6m", label: "Industry Leaderboard Rank 6M (1=best)", type: "numeric", minKey: "industry_rank_6m_min", maxKey: "industry_rank_6m_max", format: "number" },
      { key: "industry_rank_12m", label: "Industry Leaderboard Rank 12M (1=best)", type: "numeric", minKey: "industry_rank_12m_min", maxKey: "industry_rank_12m_max", format: "number" },
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
  atr_10x_above_ema50: "atrUnitsAboveEma50",
  atr_units_above_ema50_min: "atrUnitsAboveEma50",
  atr_units_above_ema50_max: "atrUnitsAboveEma50",
  industry_include: "industry",
  industry_exclude: "industry",
  sector_include: "sector",
  sector_exclude: "sector",
  ipo_date_from: "ipoDate",
  ipo_date_to: "ipoDate",
  ipo_date_from_mode: "ipoDate",
  ipo_date_to_mode: "ipoDate",
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
  earnings_last_reported_from: "earningsLastReported",
  earnings_last_reported_to: "earningsLastReported",
  sales_last_reported_from: "salesLastReported",
  sales_last_reported_to: "salesLastReported",
  eps_recent_q_min: "epsRecentQ",
  eps_recent_q_max: "epsRecentQ",
  avg_eps_2q_min: "avgEps2q",
  avg_eps_2q_max: "avgEps2q",
  eps_growth_recent_q_min: "epsGrowthRecentQ",
  eps_growth_recent_q_max: "epsGrowthRecentQ",
  avg_eps_growth_2q_min: "avgEpsGrowth2q",
  avg_eps_growth_2q_max: "avgEpsGrowth2q",
  avg_eps_growth_3q_min: "avgEpsGrowth3q",
  avg_eps_growth_3q_max: "avgEpsGrowth3q",
  avg_eps_growth_4q_min: "avgEpsGrowth4q",
  avg_eps_growth_4q_max: "avgEpsGrowth4q",
  eps_ttm_min: "epsTtm",
  eps_ttm_max: "epsTtm",
  avg_eps_2y_min: "avgEps2y",
  avg_eps_2y_max: "avgEps2y",
  eps_growth_1y_min: "epsGrowth1y",
  eps_growth_1y_max: "epsGrowth1y",
  eps_growth_2y_ago_min: "epsGrowth2yAgo",
  eps_growth_2y_ago_max: "epsGrowth2yAgo",
  avg_eps_growth_2y_min: "avgEpsGrowth2y",
  avg_eps_growth_2y_max: "avgEpsGrowth2y",
  avg_eps_growth_3y_min: "avgEpsGrowth3y",
  avg_eps_growth_3y_max: "avgEpsGrowth3y",
  sales_recent_q_min: "salesRecentQ",
  sales_recent_q_max: "salesRecentQ",
  avg_sales_2q_min: "avgSales2q",
  avg_sales_2q_max: "avgSales2q",
  sales_growth_recent_q_min: "salesGrowthRecentQ",
  sales_growth_recent_q_max: "salesGrowthRecentQ",
  avg_sales_growth_2q_min: "avgSalesGrowth2q",
  avg_sales_growth_2q_max: "avgSalesGrowth2q",
  avg_sales_growth_3q_min: "avgSalesGrowth3q",
  avg_sales_growth_3q_max: "avgSalesGrowth3q",
  avg_sales_growth_4q_min: "avgSalesGrowth4q",
  avg_sales_growth_4q_max: "avgSalesGrowth4q",
  sales_ttm_min: "salesTtm",
  sales_ttm_max: "salesTtm",
  avg_sales_2y_min: "avgSales2y",
  avg_sales_2y_max: "avgSales2y",
  sales_growth_1y_min: "salesGrowth1y",
  sales_growth_1y_max: "salesGrowth1y",
  sales_growth_2y_ago_min: "salesGrowth2yAgo",
  sales_growth_2y_ago_max: "salesGrowth2yAgo",
  avg_sales_growth_2y_min: "avgSalesGrowth2y",
  avg_sales_growth_2y_max: "avgSalesGrowth2y",
  avg_sales_growth_3y_min: "avgSalesGrowth3y",
  avg_sales_growth_3y_max: "avgSalesGrowth3y",
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
