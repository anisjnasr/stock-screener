# Market Monitor indicator drill-down and lists (revised)

## Scope (confirmed)

- **Clickable cells**: Only the **first / latest data row** for the eight indicator values: Up % / Down % (4%), Up/Down 25% (Q), Up/Down 25% (M), Up/Down 50% (M).
- **Modal columns (four only)**: **Ticker**, **Name**, **Price**, **Change %** — **no volume column.**
- **Ticker behavior**: Each ticker is **clickable**; clicking loads that symbol in the **lists section** (same as selecting a stock elsewhere). This requires wiring **`onSymbolSelect`** from [`page.tsx`](src/app/page.tsx) through [`MarketLeftPanel.tsx`](src/components/MarketLeftPanel.tsx) into [`MarketMonitorTable`](src/components/MarketMonitorTable.tsx) / the constituents modal (no longer optional).
- **Create list**: Header **Create list** uses indicator label (e.g. `4% Up`). Grouped mode: per-industry **Create list** with `"{Industry} - {indicator}"`.
- **Group / Ungroup**: Flat vs industry-grouped expandable rows; toggle button label.

## Backend: constituent query

Same metric predicates as [`getMarketMonitorBaseRowsFromDailyBars`](src/lib/screener-db-native.ts) / [`compute-market-aggregates.mjs`](scripts/compute-market-aggregates.mjs) (unchanged logic).

**Returned fields per stock**

- `symbol`, `name` (from `companies`)
- **`price`**: use **`close`** from `daily_bars` for the as-of date (this is the “price” for that session in MM context).
- **`changePct`**: qualifying expression per metric (1d / Q / M as in the plan’s table).
- `industry` (for grouping; not a visible column in flat table but needed for grouped view).

Do **not** return or display dollar volume.

**Sort**

- Up metrics: `ORDER BY changePct DESC`
- Down metrics: `ORDER BY changePct ASC` (largest down moves first)

## API

`GET /api/market-monitor/constituents?date=&metric=` → `{ stocks: [{ symbol, name, price, changePct, industry }, ...] }`

## Frontend: modal

- Table headers: **Ticker** | **Name** | **Price** | **Change %** (metric-specific label for change if needed, e.g. quarterly).
- **Ticker**: button or link styled like existing workspace symbol links; `onClick` calls **`onSymbolSelect(symbol)`**, then closes modal or leaves open per UX (default: select symbol and close modal to match common drill-down behavior — can note in implementation).
- **Price**: format like other tables (e.g. 2 decimals).

## Wiring (required)

- [`page.tsx`](src/app/page.tsx): pass `onSymbolSelect={handleSymbolSelect}` (or existing handler) to `MarketLeftPanel`.
- [`MarketLeftPanel.tsx`](src/components/MarketLeftPanel.tsx): accept `onSymbolSelect`, pass to `MarketMonitorTable`.
- [`MarketMonitorTable.tsx`](src/components/MarketMonitorTable.tsx): pass `onSymbolSelect` into the constituents modal.

## Create list

Unchanged: [`loadWatchlists`](src/lib/watchlist-storage.ts) / `saveWatchlists` + `stock-watchlists-changed`.

## Files to touch (summary)

| Area | Files |
|------|--------|
| DB | [`src/lib/screener-db-native.ts`](src/lib/screener-db-native.ts) — `price` = `close`, no volume |
| API | [`src/app/api/market-monitor/constituents/route.ts`](src/app/api/market-monitor/constituents/route.ts) |
| UI | [`MarketMonitorTable.tsx`](src/components/MarketMonitorTable.tsx), new modal component |
| Navigation | [`MarketLeftPanel.tsx`](src/components/MarketLeftPanel.tsx), [`page.tsx`](src/app/page.tsx) |

## Implementation todos

1. Add `getMarketMonitorConstituents` returning symbol, name, industry, **price** (close), changePct; sort rules above.
2. Add GET `/api/market-monitor/constituents`.
3. Modal: four columns only; clickable tickers → `onSymbolSelect`.
4. `MarketMonitorTable`: latest-row clicks; pass `onSymbolSelect` from parent chain.
5. Create list (header + per industry).
