# Stock Scanner — Project Plan

CANSLIM-style stock scanner (MarketSurge-inspired). Next.js (App Router), Tailwind, TradingView Lightweight Charts.

---

## Data sources

### Massive (formerly Polygon.io)

**Use Massive for:**

| Data | Purpose | Notes |
|------|--------|--------|
| **Stock price & volume** | Quote, daily candles, OHLCV | Snapshot API, Aggregates (daily bars) |
| **Company information** | Profile, exchange, description, identifiers | Ticker details API (`/v3/reference/tickers/{ticker}`); includes CIK, FIGI for 13F mapping |
| **Fundamentals** | Income statement, EPS, revenue, annual/quarterly | Stocks Financials v1 income-statements (SEC XBRL) |
| **News** | Stock-specific news | Reference News API (`/v2/reference/news`) |
| **Ticker search** | Symbol lookup | Reference Tickers with search |

**API key:** `MASSIVE_API_KEY` in `.env.local`. See [Massive/Polygon docs](https://polygon.io/docs).

**Note:** Earnings calendar and institutional holders are not provided by Massive; earnings can be wired to a partner API later; fund ownership uses SEC 13F only (see below).

---

### SEC EDGAR — 13F institutional holdings

**Use SEC EDGAR (free) for fund ownership only.**

- **Source:** [SEC Form 13F Data Sets](https://www.sec.gov/data-research/sec-markets-data/form-13f-data-sets) — quarterly bulk ZIPs of flattened 13F data.
- **Metric:** Total number of funds (13F filers) that hold the stock over **at least 8 quarters** (e.g. unique fund count across last 8 quarters, or per-quarter counts).
- **Identifiers:** 13F filings use **CUSIP**. Get CUSIP for each symbol from company profile (Massive ticker details or another source with CUSIP), then filter 13F holdings by that CUSIP.
- **Accuracy:** Official SEC data; same as filed. CUSIP↔ticker mapping must be correct for the count to match the intended stock.
- **Implementation outline:**
  1. Resolve symbol → CUSIP via profile (add CUSIP to profile response/types when available).
  2. Ingest or query SEC 13F bulk data (last 8 quarters): download quarterly ZIPs or use a cached/processed store.
  3. For the stock’s CUSIP: count distinct 13F filers per quarter; optionally union filers across 8 quarters for “total funds over 8 quarters.”
  4. Expose via an API route (e.g. `/api/ownership/13f` or replace/enhance `/api/ownership`) and show in UI (e.g. left sidebar).

**Do not use Massive for institutional/fund ownership** — that data comes from EDGAR 13F only.

---

## Current implementation reference

| Area | Location | Notes |
|------|----------|--------|
| Massive client | `src/lib/massive.ts` | Quote (snapshot), Profile (ticker details), income statement, news, search, historical daily; institutional-holder not used (13F only) |
| Ownership API | `src/app/api/ownership/route.ts` | Returns empty until 13F-based endpoint is implemented |
| Profile | `src/app/api/profile/route.ts` | Add CUSIP to response when wiring 13F (profile already has identifier fields where Massive provides them) |
| Fundamentals | `src/app/api/fundamentals/route.ts` | Massive income statement (annual/quarter) |
| Candles | `src/app/api/candles/route.ts` | Massive aggregates (daily OHLCV) |
| News | `src/app/api/news/route.ts` | Massive stock news |
| Quote / stock | `src/app/api/quote/route.ts`, `src/app/api/stock/route.ts` | Massive quote + profile + earnings (earnings placeholder for now) |
| Fund ownership UI | `src/components/LeftSidebar.tsx` | Displays fund count and report date; update to use 13F data and “8 quarters” wording |

---

## Funds & Ownership section — target design (to implement)

**Objective:** Redesign the Funds & Ownership block in the left sidebar to match the following layout and styling (reference: screenshot).

### Layout and content

1. **Section title**
   - Main heading: **"Owners & Funds"** (bold, prominent).

2. **Ticker**
   - Show the current symbol (e.g. **NVDA**) directly under the main title.

3. **Horizontal divider**
   - Thin gray line between ticker and the next block.

4. **Fund Ownership Summary**
   - Subheading: **"Fund Ownership Summary"** (bold).
   - Table with two columns:
     - **Date** (left-aligned) — quarterly period, e.g. Dec-25, Sep-25, Jun-25, Mar-25, Dec-24, …
     - **No. of Funds** (right-aligned) — count of funds holding the stock that quarter, with comma separators (e.g. 9,204; 9,196).
   - Show **8 quarters** of data (most recent at top).
   - Table header row with a thin gray line under it; same divider style between sections.

5. **Horizontal divider**
   - Thin gray line between Fund Ownership Summary and Ownership.

6. **Ownership**
   - Subheading: **"Ownership"** (bold).
   - One row: **"Funds"** (left) and **"X.XX%"** (right) — institutional ownership percentage, two decimal places (e.g. 40.83%).

### Styling

- White background; black/dark text; sans-serif.
- Section and table headers in bold; clear hierarchy.
- Dividers: thin horizontal gray lines between title/ticker, summary table, and ownership block.
- Numbers: comma-separated for fund counts; percentages with two decimals; right-align numeric columns.
- Fit within the left sidebar width (no horizontal scroll for this block).

### Data source

- Fund counts per quarter and ownership percentage will come from **SEC 13F + CUSIP** (see "SEC EDGAR — 13F" and implementation outline above). Until 13F is wired, placeholder or empty data can be used with this UI structure.

*To be implemented.*

---

## Summary

- **Massive (Polygon.io):** Price, volume, company info, fundamentals, news (and CIK/FIGI for 13F when needed).
- **Fund ownership:** SEC EDGAR 13F only; metric = number of funds holding the stock over at least 8 quarters; CUSIP from profile or external source.

Keep this file updated when data sources or ownership logic change.
