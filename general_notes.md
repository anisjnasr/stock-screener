# StockStalker Issues Tracker

**AI model guidance:** Use **Composer 2** for straightforward, localized work. Use **Opus 4.6** for extended reasoning, language/parser design, cross-cutting UI architecture, or whole-app loading strategy.

---

## Composer 2

### CHARTS & DATA
- ETFs chart history only displays until Jan 2025. Inspect how much history we have in the DB. It should show the full history.
- TSLA no chart data
- Flip the chart theme label — it should say "Light" when the dark theme is active and vice versa (show what you'll switch TO, not what's currently active).
- Chart width auto-adjustment: When user switches to Market Indices or Sectors/Industries sections, chart left edge should auto-adjust to fit left panel width. The indices table has a different width from the sector/industry performance. Display all columns in Indices section and full performance charts in Sectors/Industries section.

### SCANS & FILTERS
- Add Price vs MAs to scan filters and MA vs MA (binary: equal to or above or below)
- Add MA vs same MA offset back to scan filters e.g. 200MA vs 200MA 30 days ago. Helps define rising or declining MAs
- Off 52W High % scan filter: Replace the inputs with min/max % range inputs. Example: min -1% with no max filters for stocks 1% or less below their 52W high AND all stocks above their highs.

### SCANS & LISTS ORGANIZATION
- Allow scan and list drop downs to automatically expand lower as new items are added to show the full list. Cap the max height to half the page height. If more items added then add the vertical scroll

### TABLES & COLUMNS
- Customize columns menu — widen as much as necessary to avoid wrapping text.
- Add search bar to top of customize columns popup. User can type and columns containing the letter sequence appear. Small x button clears input when present.
- Off 52W High %: Calculate as negative percentage if price is below 52w high, positive if above. Color code red (below) and green (above) accordingly. Example: -5.2% (red) if $5 below a $100 high, or +3.1% (green) if $3 above.
- Double-clicking column edge should auto-size column to fit contents. Industry column currently doesn't expand enough to show full names when doing this.
- The New List ticker column width: Default is set too wide even after double clicking the column edge. Should fit tightly to content size.
- Add CTRL + A keyboard shortcut to select all stocks in a scan or list when at least one row is currently selected and active.

### RIGHT PANEL
- Add Industry RS rank under the stock's RS rank in the right panel. Use the same format as the stock RS table.
- Reduce all the fonts in the right panel proportionately
- Add/remove from watchlist doesn't work. Create popup with "New List" option followed by all existing list names. User can click "New List" to create new list with this stock, or tick checkboxes next to existing lists to add/remove stock (supports multiple list membership via multiple checkbox selections).
- Right panel Revenue and EPS tables: Default to Annual view when page opens. User can then switch to Quarterly if desired.

### HEADER BAR
- Search field auto complete pop up should be aligned to the left of the field so the left edge of the field aligns with the left edge of the popup.
- Move market status and time to the header bar far right, next to the updated date.
- Move search field to the left of main section buttons and to the right of the logo with reasonable spacing to avoid cramping the logo.

### MODALS & WINDOWS
- When new scan window is open, the draggable left edge of the chart is visible and highlights when hovered over. That should not be visible.

### NINOSCRIPT
- NinoScript help docs: Clearly state that the script uses only database data, NOT real-time data. Example: `C` today = yesterday's close (most recent saved data point). Therefore `C[1]` = close from 2 days ago. This critical timing distinction must be prominently documented.
- NinoScript help docs: Ensure all formulas are listed and defined with complete syntax + arguments (e.g., MA(data, period), SMA(data, period), ATR(length), etc). Comprehensive formula reference.
- NinoScript syntax highlighting: Make constants white. Too much color in the code currently. Reduce visual noise.
- NinoScript: Add market cap syntax `MC`. Example: `MC >= 300000000` for market cap greater than or equal to USD 300 million.

### PERFORMANCE & ARCHITECTURE
- Double-check if ETF constituents are complete in the database. Verify all holdings are captured and up-to-date for each ETF.

### BUG REPORTS
- Custom lists not persisting: Created a custom list and added a stock to it, but stock disappeared. On page refresh, the list is no longer there. Lists should persist to database.

---

## Opus 4.6

### CHARTS & DATA
- TradingView measuring tool for the chart. Research how the TradingView tool works and replicate it. SHIFT + left mouse click to trigger the start, then second click to mark the end place. Allow deletion same as other indicators.

### SCANS & LISTS ORGANIZATION
- Expandable folders in scans drop down. Default collapsed. I need you to recommend Folder button placement. The drop down needs to be fully dynamic. That means reordering: folders can be dragged to reorder, scans dragged within/between folders, highlight indicators on drag. New scans/lists continue to appear at bottom unfoldered. Folders can be renamed and deleted (with confirmation). Apply same behavior to lists dropdown.

### TABLES & COLUMNS
- Subheader row visual distinction: Subheader row should be more distinguished from main header rows. Research best practice and make a recommendation.

### RIGHT PANEL
- Right panel reorganization: Move Fundamentals/News tabs to TOP of panel above stock ticker and name. Make them tabs for entire right panel. Rename "Fundamentals" to "Profile". Profile includes profile + fundamentals tables below. News tab shows news. Highlight today's news dates in bright yellow/orange.

### NINOSCRIPT
- Update NinoScript to access all database datapoints/indicators (Industry RS, Stock RS, ATR, IPO Date, etc). Review coding syntax best practices and recommend shorthand (e.g., RS(12), IndRS(12), IPODate). Examples: RS(12) for 12-month RS, RS(6) > 90 for 90th percentile, IPODate >= "01-01-2025" for IPO filters. Update help docs with complete indicator/datapoint list and syntax.
- Add bracket lookback syntax to NinoScript: `[ ]` for accessing past values (e.g., `P[1]` for close 1 bar ago, `C[1]`). This should apply universally to all code including formulas like `MA(C,20)[10]` instead of current 3rd argument syntax.
- Add real-time script validation in NinoScript scan window. Display near results count: green "OK" if valid, red "Invalid" with reason if syntax errors detected. Provide immediate feedback to user as they write/edit code.

### PERFORMANCE & ARCHITECTURE
- The page still loads very slow. Recommendation for speeding up loading. Loading sequence idea: 1) Indices (homepage), 2) Market Monitor, 3) Lists (excluding full universe), 4) Scans, 5) Sectors/Industries (all performance timeframes pre-loaded in background). Pre-cache ALL sector performance timeframe data during load so chart timeframe switching is instant.

### NEW FEATURES (big new development — clear thorough plan)
- Custom Prompt Template Pages: Add plus button to header bar right of main sections to create new custom pages. Form fields: Page Name, AI Model (dropdown), Data Sources (Database/Web), Data Lookback (1yr/5yr/blank), Prompt. Prompt runs only when page opens using active symbol from main page. Page header shows symbol/company name. Include stock search field that re-runs prompt with new ticker on Enter.
- AI Model Auto-Recommend Feature: When custom prompt is triggered, internal Sonnet prompt evaluates user's prompt. If it requires complex multi-step reasoning, nuanced judgment, or synthesis across many data points, recommend Opus. Otherwise default to Sonnet. Automatically execute user's prompt with recommended model.
