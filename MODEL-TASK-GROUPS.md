# Task Groups by Model

Purpose: run fixes independently by model track with minimal overlap.

**Completion status:** Live-site work that is done vs still open is tracked in [`general_notes.md`](./general_notes.md) (**Completed** / **Open**). Bullets in this file are not individually checkmarked; use that file for what has shipped.

## Auto Track (low-risk, execution-focused)

### General
- Add purple flag color and update shortcut numbering (purple becomes `2`).
- Support unflagging by repeating `Shift + F`.
- Improve header behavior on narrow page widths to avoid awkward wrapping.

### AI Insights
- Add clear explanation of how lookback period is used in insights prompts.

### Left Panel / Tables
- Prevent redirect/section switch when adding a stock to a list from scan results.
- Replace scans dropdown hover folder text/icon treatment with simple folder icon.
- Color `% off 52W high` values red in tables.

### Right Panel
- Make active annual/quarterly tab state more visually distinct.

### Chart
- Fix measure tooltip formatting: remove `$` from change value and show two rows:
  - Row 1: change `%` and change
  - Row 2: bars and days
- Right-click cancels an in-progress drawing action (measure/trendline before placement).

### New Scan Filters
- Disallow negative values for `% off 52W high` inputs (minimum `0`).
- Add `New 52W High` checkbox filter.

### Operations / Verification
- Verify whether daily refresh adds new IPOs or only refreshes existing universe.

## Premium Track (complex, multi-step, higher-regression risk)

### Left Panel / Interaction Logic
- Add flag sorting with explicit precedence: green, red, yellow, purple, blue.
- Redesign scan drag/drop to allow direct positional placement within folders and reliable in-folder reorder.
- Improve drag visual cue when crossing from top-level to in-folder hierarchy (e.g., indentation cue).

### Lists Feature
- Create an Industries list from Massive industries used in the profile/right panel.
- Include columns for:
  - Industry Rank: 1M, 3M, 6M, 12M
  - % Change: 1M, 3M, 6M, 12M
- Default sort: descending by 12M rank.

### Right Panel Data/Schema
- Investigate and fix missing market cap cases (e.g., DELL) using fallback computation from available shares data.
- Merge RS and Industry RS rank into a single compact table (no heading, compact labels).
- Remove stock 1W RS usage from DB/UI path (use 1M/3M/6M/12M only).

### Historical Database / Backfill
- Perform full-universe audit for missing/incomplete financials; identify root causes.
- Fix quarterly revenue/EPS growth logic to year-over-year (Qx vs prior-year Qx), then backfill max history.
- Add dollar volume to daily bars table (`Price * Volume`) if this requires schema/pipeline changes.
- Add indicator-level ADV metrics (1M and 3M) and run backfill.

### Reference Data Migration
- Replace Massive classification with yfinance sector/industry mapping for full universe via one-time migration script.

### AI/Ninoscript Reliability
- Fix AI Insights mode routing where web-only and mixed DB/web behavior is inconsistent.
- Investigate why Ninoscript fails in New Scans for simple expressions (e.g., `P < 10`).
- Conduct end-to-end Ninoscript review/rebuild and reintegrate safely into New Scans.

## Suggested Independent Run Order

1. Run **Auto Track** first for fast wins and lower risk.
2. Run **Premium Track** in sub-phases:
   - Interaction logic (drag/drop + sorting)
   - Data/UI contract changes (right panel + industries list)
   - Historical/backfill + classification migration
   - AI/Ninoscript stabilization

## Dependencies to Watch

- Right-panel RS changes and historical metric updates may share data contracts.
- Industries list depends on trusted source mapping consistency.
- Ninoscript and scanner filters should be validated together to avoid parser/filter mismatch.
