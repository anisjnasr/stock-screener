# Stock Screener — Data Points Reference

This document lists all data points in the screener database: those from your original specification and any additional fields the schema supports. Table names and column names match `data/screener-schema.sql`. **Calculated fields** include their formulas as implemented in `scripts/refresh-daily.mjs` and `scripts/refresh-financials.mjs`.

---

## 1. Company reference data

**Table:** `companies`  
**Refresh:** Weekly / on universe change

| Data point | Column | In your list | Notes |
|------------|--------|--------------|--------|
| Ticker | `symbol` | ✓ | Primary key |
| Company name | `name` | ✓ | |
| Exchange | `exchange` | ✓ | |
| Country | `country` | ✓ | |
| City | `city` | ✓ | |
| Website | `website` | ✓ | |
| Industry | `industry` | ✓ | GICS industry |
| Sector | `sector` | ✓ | GICS sector |
| Next earnings date & time | `next_earnings_at` | ✓ | |
| Days to earnings date | `days_to_earnings` | ✓ | |
| Company description | `description` | ✓ | |
| CEO | `ceo` | ✓ | |
| CFO | `cfo` | ✓ | |
| IPO date | `ipo_date` | ✓ | |
| Related tickers / companies | `related_tickers` | ✓ | Stored as text (e.g. JSON or comma-separated) |
| Is ADR (Yes/No) | `is_adr` | ✓ | 0 = No, 1 = Yes |
| Shares outstanding | `shares_outstanding` | — | From Polygon profile; used to compute historical market cap. |
| Last updated | `updated_at` | — | Added for refresh tracking |

*No formulas — reference data only.*

**Historical backfill (Polygon):** Run `npm run backfill-historical-massive` to load 10 years of data from Polygon (Massive): `daily_bars`, `financials` (quarterly + annual), company profiles (including `shares_outstanding`), and `quote_daily` with `market_cap` = close × shares_outstanding for each date. Use `--years N` to change the window; use `--limit N` to process only the first N symbols.

---

## 2. Quote data

**Table:** `quote_daily`  
**Refresh:** Daily  
**Source:** `scripts/refresh-daily.mjs` (derived from `daily_bars` where noted)

| Data point | Column | In your list | Formula / notes |
|------------|--------|--------------|------------------|
| Market cap | `market_cap` | ✓ | Populated by `backfill-historical-massive`: close × shares_outstanding (from Polygon profile). |
| Last price | `last_price` | ✓ | Raw: close price of the latest bar. |
| % change (today) | `change_pct` | ✓ | **Formula:** \((P_{\text{today}} - P_{\text{prev}}) / P_{\text{prev}} \times 100\), where \(P\) = close. |
| Volume (today) | `volume` | ✓ | Raw: volume of the latest bar. |
| Avg daily volume — shares (30 days) | `avg_volume_30d_shares` | ✓ | **Formula:** \(\frac{1}{30} \sum_{i=1}^{30} V_i\) over the last 30 trading days (\(V\) = daily volume). |
| Avg daily volume — USD (30 days) | `avg_volume_30d_usd` | ✓ | Schema only; not populated. |
| 52-week high | `high_52w` | ✓ | **Formula:** \(\max(\text{high})\) over the last 252 trading days. |
| Off 52-week high | `off_52w_high_pct` | ✓ | **Formula:** \((\text{high\_52w} - P_{\text{close}}) / \text{high\_52w} \times 100\). % below 52w high. |
| ATR % (21 days) | `atr_pct_21d` | ✓ | **Formula:** \(\text{ATR}(21) / P_{\text{close}} \times 100\). See [ATR](#atr-average-true-range) below. |
| Free float | `free_float` | ✓ | Not populated by current scripts. |
| Date | `date` | — | Snapshot date (part of key). |

---

## 3. Daily bars (OHLCV)

**Table:** `daily_bars`  
**Refresh:** Daily (from Polygon API)

| Data point | Column | In your list | Notes |
|------------|--------|--------------|--------|
| Open | `open` | ✓ (Daily OHLCV) | |
| High | `high` | ✓ | |
| Low | `low` | ✓ | |
| Close | `close` | ✓ | |
| Volume | `volume` | ✓ | |
| Date | `date` | — | Bar date |

*No formulas — raw API data.*

---

## 4. Financials

**Table:** `financials`  
**Refresh:** Quarterly  
**Source:** `scripts/refresh-financials.mjs` (Polygon income statements + growth computed)

| Data point | Column | In your list | Formula / notes |
|------------|--------|--------------|------------------|
| EPS (annual/quarterly) | `eps` | ✓ | Raw: diluted (or basic) EPS from API. |
| EPS growth rate (YoY) | `eps_growth_yoy` | ✓ | **Formula:** \((E_{\text{curr}} - E_{\text{prior}}) / |E_{\text{prior}}| \times 100\), where \(E\) = EPS for same period type (annual or quarter), prior = same period one year earlier. |
| Sales (annual/quarterly) | `sales` | ✓ | Raw: revenue from API. |
| Sales growth rate (YoY) | `sales_growth_yoy` | ✓ | **Formula:** \((S_{\text{curr}} - S_{\text{prior}}) / |S_{\text{prior}}| \times 100\), where \(S\) = revenue, prior = same period one year earlier. |
| Period type | `period_type` | ✓ (implied) | annual / quarter |
| Period end date | `period_end` | — | End of reporting period |
| Last updated | `updated_at` | — | Refresh tracking |

---

## 5. Funds & ownership

**Table:** `ownership`  
**Refresh:** Quarterly  
**Note:** Polygon does not provide this; requires another source (e.g. SEC 13F). Schema is in place for when data is available.

| Data point | Column | In your list | Notes |
|------------|--------|--------------|--------|
| Total number of funds owning stock | `num_funds` | ✓ | Quarterly |
| Quarterly change in number of funds | `num_funds_change` | ✓ | |
| Institutional ownership % | `institutional_pct` | ✓ | |
| Top 5–10 fund owners | `top_holders` | ✓ | Stored as text (e.g. JSON) |
| Short interest % | `short_interest_pct` | ✓ | |
| Days to cover | `days_to_cover` | ✓ | |
| Report date | `report_date` | — | Quarter end |
| Last updated | `updated_at` | — | Refresh tracking |

*No formulas in current codebase — data source not wired.*

---

## 6. Price, volume & indicators

**Table:** `indicators_daily`  
**Refresh:** Daily (derived from `daily_bars`)  
**Source:** `scripts/refresh-daily.mjs`

### ATR (Average True Range)

Used for `atr_14`, `atr_pct_14`, `atr_21`, `atr_pct_21` and quote `atr_pct_21d`.

- **True Range** (per bar): \(\text{TR} = \max(H - L,\; |H - P_{\text{prev close}}|,\; |L - P_{\text{prev close}}|)\).
- **ATR(1)** = TR for that bar.
- **ATR(n)** (smoothed): \(\text{ATR}_n = \frac{\text{ATR}_{n-1} \cdot (n-1) + \text{TR}_n}{n}\).
- **ATR %** = \(\text{ATR}(n) / P_{\text{close}} \times 100\).

### EMA (Exponential Moving Average)

Used for `ema_20`, `ema_50`, `ema_100`, `ema_200`.

- **Smoothing:** \(k = 2 / (\text{period} + 1)\).
- **First value:** simple average of the first `period` closes.
- **Recursion:** \(\text{EMA}_t = P_t \cdot k + \text{EMA}_{t-1} \cdot (1 - k)\), where \(P\) = close.

---

### Price change (periods)

| Data point | Column | In your list | Formula |
|------------|--------|--------------|---------|
| Price change 1 week | `price_change_1w_pct` | ✓ | \((P_{\text{now}} - P_{5}) / P_{5} \times 100\) (5 trading days back) |
| Price change 1 month | `price_change_1m_pct` | ✓ | \((P_{\text{now}} - P_{21}) / P_{21} \times 100\) |
| Price change 3 months | `price_change_3m_pct` | ✓ | \((P_{\text{now}} - P_{63}) / P_{63} \times 100\) |
| Price change 6 months | `price_change_6m_pct` | ✓ | \((P_{\text{now}} - P_{126}) / P_{126} \times 100\) |
| Price change 12 months | `price_change_12m_pct` | ✓ | \((P_{\text{now}} - P_{252}) / P_{252} \times 100\) |

\(P_{\text{now}}\) = close on snapshot date; \(P_{n}\) = close \(n\) trading days before that.

---

### Avg volume (periods)

| Data point | Column | In your list | Formula |
|------------|--------|--------------|---------|
| Avg volume 1 week | `avg_volume_1w` | ✓ | \(\frac{1}{5} \sum \text{volume}\) over last 5 trading days |
| Avg volume 1 month | `avg_volume_1m` | ✓ | \(\frac{1}{21} \sum \text{volume}\) over last 21 trading days |

---

### ATR (periods)

| Data point | Column | In your list | Formula |
|------------|--------|--------------|---------|
| ATR 14-day | `atr_14` | — | ATR(14) as in [ATR](#atr-average-true-range) above |
| ATR % 14-day | `atr_pct_14` | — | \(\text{ATR}(14) / P_{\text{close}} \times 100\) |
| ATR 21-day | `atr_21` | ✓ | ATR(21) |
| ATR % 21-day | `atr_pct_21` | ✓ | \(\text{ATR}(21) / P_{\text{close}} \times 100\) |

---

### Price vs EMAs (above/below, % from EMA)

| Data point | Column | In your list | Formula |
|------------|--------|--------------|---------|
| EMA 20 | `ema_20` | ✓ | EMA(20) of close; see [EMA](#ema-exponential-moving-average) |
| EMA 50 | `ema_50` | ✓ | EMA(50) of close |
| EMA 100 | `ema_100` | ✓ | EMA(100) of close |
| EMA 200 | `ema_200` | ✓ | EMA(200) of close |
| Above EMA 20 (1/0) | `above_ema_20` | ✓ | 1 if close > ema_20, else 0 |
| % from EMA 20 | `pct_from_ema_20` | ✓ | \((P_{\text{close}} - \text{ema\_20}) / \text{ema\_20} \times 100\) |
| Above EMA 50 | `above_ema_50` | ✓ | 1 if close > ema_50, else 0 |
| % from EMA 50 | `pct_from_ema_50` | ✓ | \((P_{\text{close}} - \text{ema\_50}) / \text{ema\_50} \times 100\) |
| Above EMA 100 | `above_ema_100` | ✓ | 1 if close > ema_100, else 0 |
| % from EMA 100 | `pct_from_ema_100` | ✓ | \((P_{\text{close}} - \text{ema\_100}) / \text{ema\_100} \times 100\) |
| Above EMA 200 | `above_ema_200` | ✓ | 1 if close > ema_200, else 0 |
| % from EMA 200 | `pct_from_ema_200` | ✓ | \((P_{\text{close}} - \text{ema\_200}) / \text{ema\_200} \times 100\) |

---

### EMA vs EMA (above/below, % spread)

| Data point | Column | In your list | Formula |
|------------|--------|--------------|---------|
| EMA 20 above 50 (1/0) | `ema_20_above_50` | ✓ | 1 if ema_20 > ema_50, else 0 |
| EMA 20 vs 50 spread % | `ema_20_50_spread_pct` | ✓ | \((\text{ema\_20} - \text{ema\_50}) / \text{ema\_50} \times 100\) |
| EMA 50 above 100 | `ema_50_above_100` | ✓ | 1 if ema_50 > ema_100, else 0 |
| EMA 50 vs 100 spread % | `ema_50_100_spread_pct` | ✓ | \((\text{ema\_50} - \text{ema\_100}) / \text{ema\_100} \times 100\) |
| EMA 50 above 200 | `ema_50_above_200` | ✓ | 1 if ema_50 > ema_200, else 0 |
| EMA 50 vs 200 spread % | `ema_50_200_spread_pct` | ✓ | \((\text{ema\_50} - \text{ema\_200}) / \text{ema\_200} \times 100\) |
| EMA 100 above 200 | `ema_100_above_200` | ✓ | 1 if ema_100 > ema_200, else 0 |
| EMA 100 vs 200 spread % | `ema_100_200_spread_pct` | ✓ | \((\text{ema\_100} - \text{ema\_200}) / \text{ema\_200} \times 100\) |

---

### Relative strength vs S&P 500 (SPY)

Stock and SPY returns use the same lookbacks as price change (5, 21, 63, 126, 252 trading days).

| Data point | Column | In your list | Formula |
|------------|--------|--------------|---------|
| RS vs SPY 1 week | `rs_vs_spy_1w` | ✓ | \(\displaystyle \frac{1 + R_{\text{stock}}/100}{1 + R_{\text{SPY}}/100} \times 100\) |
| RS vs SPY 1 month | `rs_vs_spy_1m` | ✓ | Same, with 1M returns |
| RS vs SPY 3 months | `rs_vs_spy_3m` | ✓ | Same, with 3M returns |
| RS vs SPY 6 months | `rs_vs_spy_6m` | ✓ | Same, with 6M returns |
| RS vs SPY 12 months | `rs_vs_spy_12m` | ✓ | Same, with 12M returns |

Where \(R_{\text{stock}}\) and \(R_{\text{SPY}}\) are the period price-change percentages (e.g. \((P_{\text{now}} - P_{21})/P_{21} \times 100\) for 1M). Values &gt; 100 mean the stock outperformed SPY over that period.

---

### RS percentile (0–100, 90 = top 10%)

For screener filtering by percentile instead of raw RS. All stocks are ranked by `rs_vs_spy_*` (highest first); percentile = (total − rank + 1) / total × 100. A value of 90 means the stock is in the 90th percentile (top 10% of all stocks by RS).

| Data point | Column | Formula |
|------------|--------|---------|
| RS percentile 1 week | `rs_pct_1w` | Rank all stocks by `rs_vs_spy_1w` DESC; assign percentile. |
| RS percentile 1 month | `rs_pct_1m` | Same, using `rs_vs_spy_1m`. |
| RS percentile 3 months | `rs_pct_3m` | Same, using `rs_vs_spy_3m`. |
| RS percentile 6 months | `rs_pct_6m` | Same, using `rs_vs_spy_6m`. |
| RS percentile 12 months | `rs_pct_12m` | Same, using `rs_vs_spy_12m`. |

---

### Industry rank (IBD-style, 1 = best)

| Data point | Column | In your list | Formula |
|------------|--------|--------------|---------|
| Industry rank 1 month | `industry_rank_1m` | ✓ | Within same GICS **industry**, sort by `rs_vs_spy_1m` descending; rank = 1-based position (1 = highest RS). |
| Industry rank 3 months | `industry_rank_3m` | ✓ | Same, sort by `rs_vs_spy_3m`. |
| Industry rank 6 months | `industry_rank_6m` | ✓ | Same, sort by `rs_vs_spy_6m`. |
| Industry rank 12 months | `industry_rank_12m` | ✓ | Same, sort by `rs_vs_spy_12m`. |

---

### Sector rank (IBD-style, 1 = best)

| Data point | Column | In your list | Formula |
|------------|--------|--------------|---------|
| Sector rank 1 month | `sector_rank_1m` | ✓ | Within same GICS **sector**, sort by `rs_vs_spy_1m` descending; rank = 1-based position (1 = highest RS). |
| Sector rank 3 months | `sector_rank_3m` | ✓ | Same, sort by `rs_vs_spy_3m`. |
| Sector rank 6 months | `sector_rank_6m` | ✓ | Same, sort by `rs_vs_spy_6m`. |
| Sector rank 12 months | `sector_rank_12m` | ✓ | Same, sort by `rs_vs_spy_12m`. |

---

## Summary of data points you listed vs. schema

- **Company:** All listed (ticker, name, exchange, country, city, website, industry, sector, next earnings, days to earnings, description, CEO, CFO, IPO date, related tickers, is ADR). Schema adds `updated_at`.
- **Quote:** All listed. Schema adds `date` as part of the key. Calculated: change_pct, avg_volume_30d_shares, high_52w, off_52w_high_pct, atr_pct_21d (formulas above).
- **Daily OHLCV:** In `daily_bars` (open, high, low, close, volume).
- **Financials:** EPS, EPS growth YoY, sales, sales growth YoY for annual/quarterly; formulas in section 4.
- **Ownership:** All listed (num funds, change, institutional %, top holders, short interest %, days to cover). Data source still to be wired (e.g. SEC 13F).
- **Price change:** Fixed periods 1W, 1M, 3M, 6M, 12M; formulas in section 6.
- **Avg volume:** 1W and 1M in `indicators_daily`; 30d in `quote_daily`; formulas above.
- **ATR / ATR%:** 14d and 21d; formulas in ATR subsection.
- **EMA, price vs EMA, EMA vs EMA:** Formulas in EMA and indicator subsections.
- **RS vs S&P 500, industry rank, sector rank:** Formulas in section 6.

**Additional fields in schema not in your list:**  
`updated_at` on companies/financials/ownership; `date` / `period_end` / `report_date` as keys; ATR 14-day and ATR % 14-day in `indicators_daily`.
