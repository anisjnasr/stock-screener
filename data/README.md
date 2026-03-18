# Local stocks database

**Stocks** here means common stock (CS) and ADR common (ADRC) from Massive/Polygon only.

- **Build:** `npm run build-stocks-db` (requires `MASSIVE_API_KEY` in `.env.local`)
- **Enrich:** `npm run enrich-stocks` — adds `sector` and `industry` from Yahoo Finance (yfinance-aligned) to each stock; leaves blank if unavailable. Prints counts of stocks with missing sector/industry.
- **Output:** `data/all-stocks.json` — list of all CS + ADRC tickers with symbol, name, type, exchange, currency, sector, industry
- **Usage:** `src/lib/stocks-db.ts` — `loadStocksDb()`, `getAllStockSymbols()`, `isStockSymbol()`, `getStockRecord()`

**Index constituents** (for Watchlist “Lists” tab: Nasdaq 100, S&P 500, Russell 2000):

- **Build:** `npm run build-index-constituents` — fetches from public sources and writes `data/sp500.json`, `data/nasdaq100.json`, `data/russell2000.json` (arrays of ticker symbols).
- **Usage:** `GET /api/index-constituents?index=sp500|nasdaq100|russell2000` and `WatchlistPanel` (Lists tab).

**Thematic ETF constituents** (for Watchlist “Thematic Industries” folder):

- **Build:** `npm run build-thematic-etf-constituents` — writes `data/thematic-etf-constituents.json`.
- **Usage:** `GET /api/thematic-etf-constituents?etf=...` and thematic ETF constituent lists in `WatchlistPanel`.
- **Refresh cadence:** automatically refreshed by `npm run refresh-daily` (set `DAILY_REFRESH_THEMATIC_ETF_CONSTITUENTS=0` to disable).

---

## Screener database (`data/screener.db`)

SQLite DB for companies, daily_bars, quote_daily, indicators_daily, financials, ownership. Populated by backfill and refresh scripts.

- **Init:** `npm run init-screener-db` then `npm run seed-companies`
- **Backfill 10y (full):** `npm run backfill-historical-massive` (use `--years 10 --resume` to skip completed symbols)
- **Extend 5y to 10y:** If you already have 5 years, run `npm run backfill-extend-to-10y` to fetch the older 5 years, backfill quote_daily for 10y, and run indicators for 10y.
- **Daily:** `npm run refresh-daily` — latest bars + quote_daily + indicators + constituents files refresh
- **Indicators only:** `npm run compute-indicators [--years 10]` — recompute quote_daily and indicators_daily from daily_bars (no API calls)
- **Status:** `node scripts/check-backfill-status.mjs` — shows 5y and 10y row/symbol counts

**Performance (large DB):** The app uses `better-sqlite3` (read-only) when available so the DB is queried on disk instead of loaded into memory. Indexes on `(symbol, date)` and `(date, symbol)` keep screener and lookup queries fast. After a large backfill, consider running `ANALYZE` in SQLite to refresh statistics.
