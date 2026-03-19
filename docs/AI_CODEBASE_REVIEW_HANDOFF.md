# AI Codebase Review Handoff (Stock Scanner)

This document is a complete technical handoff for another AI agent to review this codebase with minimal additional discovery.

---

## 1) Project Identity and Goal

- **Project name:** `stock-scanner`
- **Stack:** Next.js App Router + React + TypeScript + Tailwind
- **Primary purpose:** CANSLIM-style stock research UI with:
  - charting and watchlists
  - market monitor and breadth dashboards
  - local screener database queries
  - periodic data refresh pipelines
- **Core design choice:** local, file-based SQLite (`data/screener.db`) as the canonical data store for screener/breadth/fundamentals/ownership.

---

## 2) Runtime and Build

- **Node app:** `npm run build` then `npm run start`
- **Dev:** `npm run dev`
- **Lint:** `npm run lint`
- **Health endpoint:** `GET /api/health`
- **Important:** Deployment must provide persistent storage for `data/screener.db`.

---

## 3) Repository Top-Level Structure

- `src/app/` - Next.js app router pages, API routes
- `src/components/` - UI components (charts, panels, tables)
- `src/lib/` - DB access, external API clients, utility and domain logic
- `scripts/` - DB setup, refresh, backfill, migration, diagnostics scripts
- `data/` - SQLite DB and data/caches/json assets
- `docs/` - deployment, go-live, refresh runbooks
- `.github/workflows/` - CI and scheduled refresh jobs

---

## 4) Frontend Architecture (UI and state flow)

## 4.1 Main app shell

- **Entry page:** `src/app/page.tsx` (single client page that conditionally renders app modes)
- **Modes/pages:**
  - `home`
  - `market-monitor`
  - `market-breadth` (sectors/industries/themes)
  - `breadth`

## 4.2 Primary components

- `src/components/Header.tsx`
  - symbol search
  - top-level page switching
  - quote summary snippets
- `src/components/LeftSidebar.tsx`
  - profile, news, filings tabs
  - yearly fundamentals and ownership summary
- `src/components/StockChart.tsx`
  - lightweight-charts integration
  - drawing/crosshair sync support
  - timeframe switching and chart settings
- `src/components/WatchlistPanel.tsx`
  - watchlists, screener mode, collections mode
  - row mapping for screener and quote payloads
- `src/components/QuarterlyBox.tsx`
  - quarterly EPS/sales + ownership (`# of Funds`, `Funds Chg`)
  - quarter-key alignment logic between fundamentals and ownership
- `src/components/MarketMonitorTable.tsx`
- `src/components/SectorsIndustriesPage.tsx`
- `src/components/BreadthPage.tsx`
- `src/components/NewsSidebar.tsx`

## 4.3 Home-page data fetch flow (`src/app/page.tsx`)

On symbol changes, page fetches:
- `/api/stock` (quote/profile/earnings)
- `/api/candles`
- `/api/fundamentals?period=annual`
- `/api/fundamentals?period=quarter`
- `/api/ownership`
- `/api/related-stocks`

Computed client-side derivations include:
- yearly and quarterly growth percentages
- computed ATR % and 52W high fallback from candles
- ownership quarter slicing and sorting for table/left-sidebar display

## 4.4 Frontend local caching/state persistence

- Watchlist and screener UI state persists in localStorage:
  - `src/lib/watchlist-storage.ts`
  - `src/lib/screener-storage.ts`
- Chart settings persist via `src/lib/chart-settings.ts`.

---

## 5) Backend API Architecture

All routes live in `src/app/api/*/route.ts`.

## 5.1 Market/screener and DB-backed endpoints

- `/api/health` - runtime and data freshness diagnostics
- `/api/screener` - screener rows and script results
- `/api/candles` - OHLCV + interval aggregation
- `/api/ownership` - symbol ownership quarters from DB
- `/api/fundamentals` - DB-first fundamentals with external fallback
- `/api/breadth` - breadth series and net new highs (cache-backed)
- `/api/market-monitor` - market monitor payload (cache-backed)
- `/api/sectors-industries` - sectors/industries/themes (cache-backed)
- `/api/index-constituents`
- `/api/thematic-etf-constituents`

## 5.2 External-data endpoints (network-dependent)

- `/api/stock` - quote + profile + next earnings; timeout/cached/fallback behavior
- `/api/quote`
- `/api/profile`
- `/api/news`
- `/api/search-symbol`
- `/api/related-stocks`
- `/api/watchlist-quotes`
- `/api/env-check`

---

## 6) Data Layer and DB Access

## 6.1 Canonical DB

- File: `data/screener.db`
- Schema: `data/screener-schema.sql`
- Core tables:
  - `companies`
  - `quote_daily`
  - `daily_bars`
  - `financials`
  - `ownership`
  - `indicators_daily`

## 6.2 DB access modules

- `src/lib/screener-db-native.ts`
  - primary DB path using `better-sqlite3` (read-only in API layer)
  - includes screener, breadth, ownership, financials, and classification helpers
- `src/lib/screener-db.ts`
  - fallback path using `sql.js` if native path fails

## 6.3 Notable behavior and conventions

- Date-driven reliability logic for latest screener date.
- Market monitor/breadth use index constituent JSON + DB stats.
- Ownership rows are keyed by `report_date` and should align to **calendar quarter**.

---

## 7) Caching Strategy

## 7.1 In-memory caches (globalThis)

- `/api/candles` cache (short TTL)
- `/api/fundamentals` cache (DB-first result cache)
- `/api/stock` cache (short TTL; helps avoid repeated upstream latency)

## 7.2 Disk caches in `data/`

- `breadth-cache.json`
- `market-monitor-cache.json`
- `sectors-industries-cache.json`

These caches use versioning and key limits to avoid stale payload mismatches.

---

## 8) External Integrations

- Massive/Polygon API wrappers: `src/lib/massive.ts`
- Yahoo Finance earnings wrapper: `src/lib/yahoo-earnings.ts`
- SEC 13F parsing and CUSIP mapping scripts:
  - `scripts/sec-13f-*.mjs`

---

## 9) Scripts and Operations

Key npm scripts in `package.json`:

- Setup/migrations:
  - `init-screener-db`
  - `seed-companies`
  - `migrate-add-is-etf`
  - `migrate-add-rs-percentile`
- Refresh:
  - `refresh-safe`
  - `refresh-daily`
  - `refresh-financials`
  - `refresh-ownership`
  - `refresh-companies`
  - `refresh:all`
- Backfill:
  - `backfill-historical-massive`
  - `backfill-extend-to-10y`
  - `backfill-daily-history`
- Quality/diagnostics:
  - `go-live:check`
  - `check-ownership-refresh`
  - `market-monitor:stats`
  - `sample-tables`
  - `optimize-db`

---

## 10) CI, Scheduled Jobs, and Deployment

## 10.1 Workflows

- `.github/workflows/ci.yml`
- `.github/workflows/daily-refresh.yml`
- `.github/workflows/ownership-refresh.yml`
- `.github/workflows/db-backup.yml`

## 10.2 Deployment docs

- `docs/DEPLOY.md`
- `docs/GO_LIVE.md`
- `docs/DATA-REFRESH-SETUP.md`

## 10.3 Critical deployment invariant

The app can report `hasDb: true` while key tables are empty if the deployed DB file differs from local expectations. Always inspect `/api/health` table-level diagnostics (`ownership`, `financials`, `quoteDaily`) after deploy.
Health also exposes readiness flags under `checks` and returns HTTP `503` if required datasets are missing.

---

## 11) Known High-Risk Areas (Review Priorities)

If another AI is reviewing this repo, prioritize these:

1. **Quarter alignment between fundamentals and ownership**
   - `src/components/QuarterlyBox.tsx`
   - Check date-vs-fiscal-quarter matching edge cases.
2. **DB freshness and deployment consistency**
   - `src/app/api/health/route.ts`
   - Ensure health diagnostics stay stable and type-safe.
3. **Fallback behavior under upstream slowness**
   - `src/app/api/stock/route.ts`
   - Verify timeouts and DB fallback do not produce malformed payloads.
4. **Cache invalidation/versioning**
   - breadth/market-monitor/sectors-industries caches in API routes.
5. **Large DB performance**
   - `src/lib/screener-db-native.ts` query plans and index assumptions.
6. **Script idempotency and safety**
   - refresh/backfill scripts in `scripts/`.

---

## 12) Verification Checklist (for reviewer AI)

Reviewer AI should run or inspect:

1. **Build and lint**
   - `npm run lint`
   - `npm run build`
2. **Data health**
   - `npm run go-live:check`
   - `npm run check-ownership-refresh`
   - `GET /api/health`
3. **Critical API samples**
   - `/api/ownership?symbol=AAPL`
   - `/api/fundamentals?symbol=AAPL&period=quarter`
   - `/api/market-monitor`
   - `/api/breadth?index=sp500`
4. **UI behavior checks**
   - Home page quarterly table fund rows for AAPL/NVDA/MSFT/AMZN.
   - Market monitor 52W net new highs non-zero where expected.

---

## 13) Environment Variables and Secrets

Primary:
- `MASSIVE_API_KEY` (required)

Optional:
- `OPENFIGI_API_KEY` (improves CUSIP-to-symbol mapping in 13F scripts)

Never commit `.env.local`.

---

## 14) Data Assets and Generated Files

Persistent/required:
- `data/screener.db`

Generated/refresh artifacts:
- `data/breadth-cache.json`
- `data/market-monitor-cache.json`
- `data/sectors-industries-cache.json`
- `data/backups/*`

Transient build/dev:
- `.next/*`
- `.tmp-gh-artifacts/*`

---

## 15) Reviewer Prompt Template (Copy/Paste)

Use this prompt with another AI reviewer:

```text
You are reviewing a Next.js + TypeScript stock research app. Use docs/AI_CODEBASE_REVIEW_HANDOFF.md as the primary system map.

Review goals:
1) Find correctness issues, regressions, and data-integrity risks.
2) Identify performance bottlenecks in API/data layer and frontend fetch flow.
3) Validate cache invalidation and timeout/fallback behavior.
4) Validate deployment/data-refresh assumptions and failure modes.
5) Propose specific patches with file-level references.

Focus files first:
- src/app/api/health/route.ts
- src/app/api/stock/route.ts
- src/app/api/fundamentals/route.ts
- src/components/QuarterlyBox.tsx
- src/lib/screener-db-native.ts
- scripts/refresh-financials.mjs
- scripts/refresh-ownership.mjs

Return:
- Findings ordered by severity (Critical/High/Medium/Low)
- Repro steps for each finding
- Suggested fixes
- Tests/verification commands
```

---

## 16) Reviewer Output Format Recommendation

Ask the reviewer AI to output:

- **Findings first** (severity ordered)
- **Assumptions/open questions**
- **Patch plan** (small, safe commits)
- **Validation results** (commands + observed output summary)

---

## 17) Quick Operator Runbook

If UI shows missing ownership/fund counts in production:

1. Check `/api/health`:
   - if `ownership.rows === 0`, run ownership refresh on deploy environment.
2. Run:
   - `npm run refresh-safe -- --skip-daily --ownership-latest-only`
   - `npm run check-ownership-refresh`
3. If fundamentals are missing:
   - `npm run refresh-safe -- --skip-daily --skip-ownership`
4. Restart service and re-check `/api/health`.

---

## 18) Suggested Next Improvements

- Add endpoint-level timing metrics for upstream calls (`/api/stock`, `/api/fundamentals` fallback path).
- Add table freshness thresholds in `/api/health` (warn/degraded based on staleness).
- Add integration smoke tests for ownership + quarterly table alignment.
- Standardize script logging JSON mode for easier machine analysis.

