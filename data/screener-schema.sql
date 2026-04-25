-- Stock Screener Database Schema
-- SQLite. Run via: sqlite3 data/screener.db < data/screener-schema.sql
-- Or via init script that executes this file.

-- 1. companies (1 row per symbol) — refresh weekly / on universe change
CREATE TABLE IF NOT EXISTS companies (
  symbol TEXT PRIMARY KEY,
  name TEXT,
  exchange TEXT,
  country TEXT,
  city TEXT,
  website TEXT,
  industry TEXT,
  sector TEXT,
  next_earnings_at TEXT,
  days_to_earnings INTEGER,
  description TEXT,
  ceo TEXT,
  cfo TEXT,
  ipo_date TEXT,
  related_tickers TEXT,
  is_adr INTEGER NOT NULL DEFAULT 0,
  is_etf INTEGER NOT NULL DEFAULT 0,
  shares_outstanding REAL,
  updated_at TEXT
);

-- 2. quote_daily (1 row per symbol per date) — refresh daily
CREATE TABLE IF NOT EXISTS quote_daily (
  symbol TEXT NOT NULL,
  date TEXT NOT NULL,
  market_cap REAL,
  last_price REAL,
  change_pct REAL,
  volume INTEGER,
  avg_volume_30d_shares REAL,
  avg_volume_30d_usd REAL,
  high_52w REAL,
  off_52w_high_pct REAL,
  atr_pct_21d REAL,
  free_float REAL,
  prev_close REAL,
  PRIMARY KEY (symbol, date),
  FOREIGN KEY (symbol) REFERENCES companies(symbol)
);
CREATE INDEX IF NOT EXISTS idx_quote_daily_date_symbol ON quote_daily (date, symbol);
CREATE INDEX IF NOT EXISTS idx_quote_daily_date_covering ON quote_daily (date, symbol, last_price, change_pct, volume, market_cap, prev_close, atr_pct_21d, high_52w, off_52w_high_pct, avg_volume_30d_shares);

-- 3. daily_bars (OHLCV) — refresh daily
CREATE TABLE IF NOT EXISTS daily_bars (
  symbol TEXT NOT NULL,
  date TEXT NOT NULL,
  open REAL,
  high REAL,
  low REAL,
  close REAL,
  volume INTEGER,
  dollar_volume REAL,
  PRIMARY KEY (symbol, date),
  FOREIGN KEY (symbol) REFERENCES companies(symbol)
);
CREATE INDEX IF NOT EXISTS idx_daily_bars_symbol_date ON daily_bars (symbol, date);
CREATE INDEX IF NOT EXISTS idx_daily_bars_date ON daily_bars (date);
CREATE INDEX IF NOT EXISTS idx_daily_bars_covering ON daily_bars (symbol, date, close, high, low, volume, dollar_volume, open);

-- 4. financials (quarterly + annual) — refresh quarterly
CREATE TABLE IF NOT EXISTS financials (
  symbol TEXT NOT NULL,
  period_type TEXT NOT NULL,
  period_end TEXT NOT NULL,
  eps REAL,
  eps_growth_yoy REAL,
  sales REAL,
  sales_growth_yoy REAL,
  fiscal_period TEXT,
  fiscal_year INTEGER,
  updated_at TEXT,
  PRIMARY KEY (symbol, period_type, period_end),
  FOREIGN KEY (symbol) REFERENCES companies(symbol)
);
CREATE INDEX IF NOT EXISTS idx_financials_symbol ON financials (symbol);

-- 5. ownership (quarterly) — refresh quarterly
CREATE TABLE IF NOT EXISTS ownership (
  symbol TEXT NOT NULL,
  report_date TEXT NOT NULL,
  num_funds INTEGER,
  num_funds_change INTEGER,
  institutional_pct REAL,
  short_interest_pct REAL,
  days_to_cover REAL,
  top_holders TEXT,
  updated_at TEXT,
  PRIMARY KEY (symbol, report_date),
  FOREIGN KEY (symbol) REFERENCES companies(symbol)
);
CREATE INDEX IF NOT EXISTS idx_ownership_symbol ON ownership (symbol);

-- 5b. ipo discovery state/logging — refreshed during daily refresh
CREATE TABLE IF NOT EXISTS ipo_discovery_log (
  run_date TEXT NOT NULL,
  symbol TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_date, symbol)
);
CREATE INDEX IF NOT EXISTS idx_ipo_discovery_log_symbol ON ipo_discovery_log (symbol, run_date);

CREATE TABLE IF NOT EXISTS ipo_ingest_state (
  symbol TEXT PRIMARY KEY,
  first_seen_date TEXT,
  last_seen_date TEXT,
  last_ingested_at TEXT,
  status TEXT,
  last_error TEXT,
  updated_at TEXT,
  FOREIGN KEY (symbol) REFERENCES companies(symbol)
);
CREATE INDEX IF NOT EXISTS idx_ipo_ingest_state_status ON ipo_ingest_state (status, updated_at);

-- 6. indicators_daily — refresh daily (derived from daily_bars)
CREATE TABLE IF NOT EXISTS indicators_daily (
  symbol TEXT NOT NULL,
  date TEXT NOT NULL,
  price_change_1w_pct REAL,
  price_change_1m_pct REAL,
  price_change_3m_pct REAL,
  price_change_6m_pct REAL,
  price_change_12m_pct REAL,
  avg_volume_1w REAL,
  avg_volume_1m REAL,
  avg_dollar_volume_1m REAL,
  avg_dollar_volume_3m REAL,
  atr_14 REAL,
  atr_pct_14 REAL,
  atr_21 REAL,
  atr_pct_21 REAL,
  ema_20 REAL,
  ema_50 REAL,
  ema_100 REAL,
  ema_200 REAL,
  above_ema_20 INTEGER,
  pct_from_ema_20 REAL,
  above_ema_50 INTEGER,
  pct_from_ema_50 REAL,
  above_ema_100 INTEGER,
  pct_from_ema_100 REAL,
  above_ema_200 INTEGER,
  pct_from_ema_200 REAL,
  ema_20_above_50 INTEGER,
  ema_20_50_spread_pct REAL,
  ema_50_above_100 INTEGER,
  ema_50_100_spread_pct REAL,
  ema_50_above_200 INTEGER,
  ema_50_200_spread_pct REAL,
  ema_100_above_200 INTEGER,
  ema_100_200_spread_pct REAL,
  atr_units_above_ema50 REAL,
  atr_multiple_sma50 REAL,
  avg_volume_20d REAL,
  episodic_pivot INTEGER,
  ema_200_lag_20 REAL,
  ema_200_lag_30 REAL,
  ema_200_lag_60 REAL,
  rs_vs_spy_1w REAL,
  rs_vs_spy_1m REAL,
  rs_vs_spy_3m REAL,
  rs_vs_spy_6m REAL,
  rs_vs_spy_12m REAL,
  rs_pct_1w REAL,
  rs_pct_1m REAL,
  rs_pct_3m REAL,
  rs_pct_6m REAL,
  rs_pct_12m REAL,
  industry_rank_1m INTEGER,
  industry_rank_3m INTEGER,
  industry_rank_6m INTEGER,
  industry_rank_12m INTEGER,
  sector_rank_1m INTEGER,
  sector_rank_3m INTEGER,
  sector_rank_6m INTEGER,
  sector_rank_12m INTEGER,
  PRIMARY KEY (symbol, date),
  FOREIGN KEY (symbol) REFERENCES companies(symbol)
);
CREATE INDEX IF NOT EXISTS idx_indicators_daily_date_symbol ON indicators_daily (date, symbol);
CREATE INDEX IF NOT EXISTS idx_indicators_daily_covering ON indicators_daily (
  date, symbol,
  price_change_1w_pct, price_change_1m_pct, price_change_3m_pct, price_change_6m_pct, price_change_12m_pct,
  rs_pct_1w, rs_pct_1m, rs_pct_3m, rs_pct_6m, rs_pct_12m,
  rs_vs_spy_1w, rs_vs_spy_1m, rs_vs_spy_3m, rs_vs_spy_6m, rs_vs_spy_12m,
  industry_rank_1m, industry_rank_3m, industry_rank_6m, industry_rank_12m,
  sector_rank_1m, sector_rank_3m, sector_rank_6m, sector_rank_12m
);

-- 7. market_monitor_daily — precomputed during daily refresh
CREATE TABLE IF NOT EXISTS market_monitor_daily (
  date TEXT PRIMARY KEY,
  up4pct INTEGER NOT NULL DEFAULT 0,
  down4pct INTEGER NOT NULL DEFAULT 0,
  ratio5d REAL,
  ratio10d REAL,
  up25pct_qtr INTEGER NOT NULL DEFAULT 0,
  down25pct_qtr INTEGER NOT NULL DEFAULT 0,
  up25pct_month INTEGER NOT NULL DEFAULT 0,
  down25pct_month INTEGER NOT NULL DEFAULT 0,
  up50pct_month INTEGER NOT NULL DEFAULT 0,
  down50pct_month INTEGER NOT NULL DEFAULT 0,
  sp500_pct_above_50d REAL,
  sp500_pct_above_200d REAL,
  nasdaq_pct_above_50d REAL,
  nasdaq_pct_above_200d REAL,
  universe_pct_above_50d REAL,
  universe_pct_above_200d REAL,
  universe INTEGER NOT NULL DEFAULT 0,
  nnh_1m_highs INTEGER,
  nnh_1m_lows INTEGER,
  nnh_1m_net INTEGER,
  nnh_3m_highs INTEGER,
  nnh_3m_lows INTEGER,
  nnh_3m_net INTEGER,
  nnh_6m_highs INTEGER,
  nnh_6m_lows INTEGER,
  nnh_6m_net INTEGER,
  nnh_52w_highs INTEGER,
  nnh_52w_lows INTEGER,
  nnh_52w_net INTEGER,
  count_10x_atr_50d INTEGER,
  count_7x_atr_50d INTEGER,
  count_episodic_pivot INTEGER,
  updated_at TEXT
);

-- 8. breadth_daily — precomputed during daily refresh
CREATE TABLE IF NOT EXISTS breadth_daily (
  index_id TEXT NOT NULL,
  date TEXT NOT NULL,
  nnh_1m_highs INTEGER,
  nnh_1m_lows INTEGER,
  nnh_1m REAL,
  nnh_3m_highs INTEGER,
  nnh_3m_lows INTEGER,
  nnh_3m REAL,
  nnh_6m_highs INTEGER,
  nnh_6m_lows INTEGER,
  nnh_6m REAL,
  nnh_52w_highs INTEGER,
  nnh_52w_lows INTEGER,
  nnh_52w REAL,
  pct_above_50d REAL,
  pct_above_200d REAL,
  count_50d INTEGER,
  count_200d INTEGER,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (index_id, date)
);
CREATE INDEX IF NOT EXISTS idx_breadth_daily_date ON breadth_daily(date);
