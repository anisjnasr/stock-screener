# StockStalker — Comp Lab
### Build Blueprint (v1: calibration)

> **Purpose of this document:** This is a specification for Cursor to implement. It describes a new top-level section of StockStalker called **Comp Lab** — a calibration and research tool for the comp engine that already powers the live Large Cap Analysis section. Read the whole document before writing code. Where it says *"Cursor decides"*, use judgment based on the existing codebase and explain the choice in a comment. Do not add features beyond what is described here.
>
> **Implementation note (v1):** The rating store uses `profile_id` (StockStalker `profiles` table), matching watchlists and other user data — not the blueprint's `user_id` column name.

---

## 1. Purpose and scope

The Comp Lab is a dedicated page for **studying and rating the comps** that StockStalker's comp engine produces. Its primary job in v1 is **calibration**: building a labelled dataset of "good vs. bad" comp matches so the engine can be tuned over time.

A "comp" is a historical day in a stock's own price history that resembles a given reference setup. The live Large Cap Analysis section already uses the comp engine to surface comps automatically each morning. The Lab lets the user examine those comps in detail, at their own pace, for any stock and any historical reference date — not just today.

**What the Lab is:**
- A research and calibration interface on top of the *existing* comp engine.
- A way to systematically rate comp match quality and accumulate a dataset for analysis.
- A tool used outside of pre-market hours, when the user has time to look carefully.

**What the Lab is not:**
- It is not a strategy backtester. It does not measure P&L. It evaluates whether the engine's *matching* is good, not whether trading the matches would have made money.
- It does not automatically modify the comp engine. The engine is improved through a deliberate, human-driven tuning loop informed by Lab data — never through auto-update. See Section 11.
- It is not the live pre-market tool. There is no automatic linkage from the Lab back to the live analysis — they're separate by design.

**Single-user, multi-user-ready.** The Lab is currently used by one user (the project owner). All storage is keyed by `user_id` so the architecture is multi-user-safe from day one, but no multi-user features (sharing, comparing ratings between users) are built in v1.

**Critical design decision — no auto-tuning in v1.** Ratings accumulate as a labelled dataset. They do **not** feed back into the engine in real time. The pathway from ratings to engine improvement is a manual, deliberate analysis-and-tuning loop, designed properly in a future iteration once enough data exists. See Section 11.

---

## 2. Architecture

The Lab reuses the existing comp engine and adds three new pieces around it:

```
┌───────────────────────────────────────────────────────────────┐
│ 1. EXISTING comp engine (no parallel version)                  │
│    - Builds setup signatures, finds matches, scores similarity │
│    - Used as-is, with one small extension: "lab mode"          │
│      (lookahead-bias restriction — see Section 8)              │
└────────────────────┬──────────────────────────────────────────┘
                     │
┌────────────────────▼──────────────────────────────────────────┐
│ 2. NEW Comp Lab page (Next.js)                                 │
│    - Ticker search + reference date picker                     │
│    - Interactive setup chart                                   │
│    - Comp grid with mini-charts and rating controls            │
└────────────────────┬──────────────────────────────────────────┘
                     │
┌────────────────────▼──────────────────────────────────────────┐
│ 3. NEW Supabase rating store                                   │
│    - One row per (user, reference setup, comp) rating          │
│    - Latest-wins update model                                  │
└───────────────────────────────────────────────────────────────┘
```

Reuse the existing comp engine. Do not build a parallel version. The Lab calls the same engine the live page calls, with one new parameter that activates lab mode.

---

## 3. Page placement and navigation

The Lab is a new **top-level item in the main header navigation**, labelled **"Comp Lab"**. It sits alongside Market, Industries, Scans, Lists, and Pre-Market.

The page is reachable directly at `/comp-lab` (or whatever route convention the app already uses). It is its own URL, bookmarkable.

---

## 4. Page states and persistence

The page has three states:

**A — Empty (first visit of the day):**
- Stock ticker search field, focused by default.
- A short one-line explanation of what the page does.
- No chart, no comp grid, nothing else.

**B — Stock loaded, no reference date selected:**
- The setup chart appears below the ticker search.
- A reference-date picker is visible but no date has been chosen yet.
- No comp grid yet.
- The user picks a date by either typing in the date field *or* clicking a candle on the chart (see Section 5).

**C — Stock loaded, reference date selected, comps generated:**
- Setup chart with the reference candle marked.
- Date picker shows the chosen date.
- Sort toggle and rating legend.
- Comp grid populated below.
- Show More button at the bottom if more comps exist beyond the first 10.

**Persistence rules:**
- **Within a single day's first session:** start in state A.
- **Within the same day, after the user navigates away and returns:** restore the last state (B or C) with the last ticker, date, sort order, and any rating updates the user made. Cache the search and results in memory/localStorage; ratings live in Supabase and reload from there.
- **On the next day's first visit:** state A again. Yesterday's search is not auto-restored — fresh start.
- **Cross-device:** because all ratings live in Supabase keyed by user, the user can switch device and immediately see their accumulated ratings. The transient state (currently selected ticker/date) does not need to follow the user across devices in v1 — only the rating data does.

---

## 5. The setup chart (top of page)

The setup chart is the page's primary visual interface. It is **interactive (dynamic)** and prominent at the top.

**Defaults:**
- Timeframe: daily.
- Window: 6 months prior to today (or to the most recent trading date the stock has data for) by default. The user can scroll/pan to see earlier history.
- Overlays: EMA 20, EMA 50, SMA 200, all drawn over the candlesticks.
- Candle style: the existing StockStalker candlestick theme — grey/black bodies — used elsewhere on the platform. Match exactly; do not invent a new style.
- All charts default to daily timeframe.

**Marking the reference candle:**
- The user selects the reference candle in one of two synced ways:
  1. **Click a candle** on the chart. That candle's body becomes **green-filled** to mark it as selected. A second click on the same selected candle **deselects** it (the body returns to normal grey/black). Clicking a different candle moves the selection.
  2. **Type a date** in the reference-date input field. The chart jumps to centre on that date and marks the corresponding candle green-filled.
- Date input and candle selection are always in sync — changing one updates the other.

**Invalid dates:**
- Invalid dates (today's date, future dates, dates before the stock's earliest available data, weekends, market holidays) are **visually greyed out** in the date picker and cannot be selected.
- In the chart, today's candle (if rendered) is not clickable.

**Why the candle marker uses green fill:**
The existing candlestick theme uses grey and black bodies. A green-filled candle stands out unambiguously without introducing decorative effects (glow, halo, etc.). It also matches the "active selection" affordance pattern.

---

## 6. The controls row (between setup chart and comp grid)

Once a reference date is selected, a controls row appears between the setup chart and the comp grid.

It contains:

- **Reference date display** — read-only, shows the selected date in `YYYY-MM-DD` format, with a small "Clear" link to deselect.
- **Sort toggle** — two options: `Similarity` (default) and `Recent`. A simple two-state pill or segmented control.
- **Rating legend** — a single line of muted text reading:
  > `Rate match quality: 1 = barely related · 5 = near-identical · ignore the outcome`
  The phrase "ignore the outcome" is mandatory and must appear literally — it enforces the discipline of rating match quality, not result.
- **Match count** — small text showing `N comps found · M rated`. (e.g. "23 comps found · 7 rated")

---

## 7. The comp grid

Below the controls row, the comp grid displays matched comps as cards, **two cards per row**, **10 cards per page**.

**Pagination:**
- The first 10 comps display by default.
- A **Show More** button at the bottom adds another 10. Clicking again adds another 10. And so on, until all comps are loaded.
- No traditional pagination (no page numbers) — just append. The user is doing rapid sequential review and doesn't need to jump around.

**Sort order:**
- Default: descending by similarity score (most-similar first).
- Toggle to `Recent`: descending by date (most-recent first).
- The sort applies to the whole result set; switching sort re-orders before pagination.

**Each comp card contains:**
1. **Mini chart (top):** a static candlestick chart, 40 trading days wide — **35 days before the comp date (inclusive)** and **5 days after**. Same candle theme as the rest of the platform. Same MA overlays (EMA 20, EMA 50, SMA 200). The 5 post-setup days render at slightly reduced opacity (~70%) so the eye can distinguish "the setup" from "what happened after."
2. **The comp's date** — prominent, e.g. `2024-03-15`.
3. **Setup signature** — a compact, muted display of the comp's setup characteristics: gap bucket, range state, trend label. (e.g. `Moderate gap up · Tight base · Uptrend`.) This is the engine's own classification of the comp; it lets the user see *why* the engine matched it.
4. **Similarity score** — prominent, shown as a number out of 100 (or whatever scale the engine uses). Placed near the rating control so the user can compare their judgment to the engine's at a glance.
5. **Outcome label** — what the comp's next session did, in plain language: `Followed through +3.4%` / `Reversed −5.1%` / `Flat (+0.2%)`. **This is shown for context, not for rating.** The legend reminds the user to ignore it when rating.
6. **Rating control** — five numbered buttons: `1  2  3  4  5`. Single-click to set; clicking a different number updates. Visual treatment: the selected number's button has a filled cyan background; the others are outlined. If the comp has been previously rated, the prior rating is pre-filled.
7. **Rated indicator** — a small label/badge on the card showing `Rated` if it has been rated (any prior rating exists in the store). Distinct from unrated cards at a glance.

**Card click behaviour:**
- Clicking the **mini chart** opens a **full interactive view in a modal** — same candle theme, full pan/zoom, full MA overlays, larger size, with the setup candle still marked green. The modal closes with an X button or Escape key. The page beneath does not lose state.
- Clicking the rating buttons does not open the modal — they have their own click handlers.

**Empty state (zero comps):**
When the engine returns zero matches:
- The grid area shows a clear message: `No comps found for this setup with current tolerances.`
- A second line: `Try loosening tolerances in the comp engine config, or pick a different reference date.`
- No empty cards, no skeleton placeholders — just the message.

---

## 8. Lab-mode engine extension (lookahead bias — critical)

The Lab adds a single new parameter to the comp engine: **`lab_mode_reference_date`**.

When this parameter is set, the engine **must restrict the search history to dates strictly before the reference date**. No data from on-or-after the reference date can be used for matching, scoring, outcome computation, or any other purpose.

This is non-negotiable. Without it, the Lab is silently broken: a reference date in 2023 could match against 2024 days, and every statistic would be contaminated with future information that didn't exist when the reference setup was happening.

**Implementation requirements:**
- The restriction must be enforced at the data-fetch layer of the engine — not as a post-filter on results. (Post-filtering is bug-prone; data-layer enforcement is reliable.)
- The engine logs the active `lab_mode_reference_date` for every Lab-mode call so it can be verified.
- The live Large Cap Analysis call does not pass this parameter and behaves exactly as today.
- Add an automated test that calls the engine in lab mode with a 2023 reference date and asserts that no result has a date ≥ the reference date.

**No other engine behaviour changes.** Matching rules, tolerances, scoring weights, and result format are all unchanged. The Lab is a second front-end onto the same engine; it does not create a parallel codebase.

---

## 9. Data model — the rating store

A new Supabase table stores all ratings.

**Table: `comp_ratings`**

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | Primary key |
| `user_id` | uuid | FK to user profile; indexed |
| `reference_ticker` | text | The stock the setup chart was loaded for |
| `reference_date` | date | The reference candle date |
| `comp_ticker` | text | The matched comp's stock (same as reference_ticker in v1, since cross-stock comps are out of scope, but include the field for future-proofing) |
| `comp_date` | date | The matched comp's date |
| `rating` | smallint | 1–5 |
| `created_at` | timestamptz | When first rated |
| `updated_at` | timestamptz | When last updated; updated on every change |
| `engine_similarity_score` | numeric | The engine's similarity score at the time of rating (stored for later analysis — to see where user and engine agree/disagree) |

**Uniqueness:**
- Unique constraint on `(user_id, reference_ticker, reference_date, comp_ticker, comp_date)`. One rating per user per comp pair.
- New ratings update the existing row's `rating` and `updated_at` — latest wins.

**Indexes:**
- `(user_id, reference_ticker, reference_date)` — for fast "load all ratings for this lab session" lookups.
- `(user_id, updated_at)` — for "show me my recent ratings" queries later.

**The rating store is queried at two times:**
1. When a comp grid loads — to pre-fill prior ratings on already-rated comps.
2. On rating updates — write through immediately on click.

---

## 10. Interactions and visual treatment

**Save-on-click behaviour:**
- Clicking a rating number immediately writes (or updates) the row in Supabase.
- The button shows a brief success confirmation: the clicked button stays filled cyan, with a one-second subtle pulse animation to confirm the save took. No "saved" toast, no separate save button.
- On save failure (network error, etc.), the button reverts to its prior state and an unobtrusive inline error message appears on the card. The user can click again to retry.

**Loading states:**
- When comps are being fetched, show a skeleton grid (10 placeholder cards) rather than a blank screen.
- The setup chart shows a loading spinner only on first chart load. After that, scrolling/panning within the chart should not show loading states.
- The interactive modal opens immediately with a small loading indicator while the larger chart data renders.

**Visual treatment:**
- Match the existing StockStalker dark terminal theme exactly: `#171717` background, `#3BBFCF` cyan accent, JetBrains Mono for numerals, Barlow Condensed for UI labels.
- The rated/unrated indicator on cards uses the same `Rated` badge style as other status badges elsewhere on the platform.
- The similarity score uses the same monospace numeric treatment as other engine-computed numbers.
- The legend text is muted (~60% opacity of body text) so it doesn't compete with the comp data.

---

## 11. The path to engine improvement (out of scope for v1; explicit for clarity)

The Lab's reason to exist is to make the comp engine better over time. This section makes the v1/v2 boundary explicit so it doesn't drift during build or after.

**In v1 (this build):**
- Ratings are collected and stored.
- The user can review their own ratings (they pre-fill on subsequent loads).
- No automatic engine modification of any kind.

**In v2 (future, designed when v1 has accumulated enough data):**
- An analysis step examines the rating data to identify systematic patterns: "the user consistently rates comps with feature X poorly while the engine scores them highly."
- This analysis can be done by Claude reading the rating data and proposing tolerance/weight changes to the engine config, *or* manually by the user.
- The engine config is updated **deliberately, by a human, after review** — not automatically by the system.
- The engine is never modified in real time by an individual rating.

**Minimum sample thresholds for v2 — locked in now, applied later.**

To prevent the engine from being tuned on noise, the v2 tuning process is governed by two minimum-sample thresholds. These are not enforced in v1 code (nothing is being tuned yet), but they are recorded here so the v2 design starts from them — and they shape what counts as "enough data" before tuning can begin.

| Threshold | Value | What it gates |
|---|---|---|
| **Total dataset minimum** | **100 ratings** | No v2 tuning process runs at all until the user has accumulated at least 100 ratings across the rating store. Below this, the dataset is too small to support reliable pattern analysis. |
| **Per-pattern minimum** | **20 ratings** | No individual feature, tolerance, or weight is adjusted based on ratings until there are at least 20 ratings of comps exhibiting that pattern. Below this, any conclusion about a specific pattern is dominated by noise. |

**Why these numbers:**
- 100 total is the smallest dataset that supports distinguishing systematic engine issues from clustered chance. It's also achievable: at 5–10 ratings per Lab session, the user reaches it in 2–3 weeks of regular use.
- 20 per pattern is the pragmatic floor where rating averages start being meaningful for a single sub-population. Statisticians often cite 30 as a softer rule; 20 is the floor for a tool of this kind.

**Future consideration (not v1, not v2 initial design):** a rating recency window. Ratings older than ~6 months may need to be weighted lower or excluded from tuning analysis, since both the user's eye and the market evolve over time. Don't bake this in yet — but the rating store already captures `updated_at`, so the option exists when needed.

**Why this matters:** auto-tuning the engine on individual ratings — or even on small accumulated samples — would amplify noise (a single rating doesn't carry statistical weight), would chase the user's mood swings, and could quietly degrade the engine in ways that are very hard to unwind. The right model is *human-and-data-driven tuning* with strict sample-size gates, not autonomous self-update. The Lab is the instrument that *enables* tuning; it is not itself the tuning. The thresholds above are the guardrails that make the tuning honest when it eventually happens.

Build v1 to support v2 — that means storing enough data on each rating (especially `engine_similarity_score`) to support later pattern analysis. Do not build v2 features in v1.

---

## 12. Out of scope for v1

To keep this build sharp, the following are explicitly **not** built now:

- Any automatic engine modification based on ratings.
- Cross-stock comp matching (the engine only finds comps within the same stock's history).
- Sharing ratings between users; multi-user comparison or collaboration features.
- Aggregate dashboards of "ratings over time" or "rating-vs-similarity correlation." (Useful later; not v1.)
- Export of rating data.
- Filtering or searching within the comp grid (e.g. "show me only comps I rated below 3").
- Per-comp notes or free-text annotations.
- Suggestions from Claude about which tolerances to adjust based on ratings.
- Alerts when accumulated ratings reach a milestone.

---

## 13. Build order for Cursor

Build in stages. Stop and let the user verify after each.

1. **Database & engine extension.**
   - Create the `comp_ratings` table in Supabase with the schema in Section 9, including all indexes and constraints.
   - Extend the comp engine to accept the `lab_mode_reference_date` parameter (Section 8). Enforce at the data-fetch layer. Add the automated lookahead-bias test. Confirm the live Large Cap Analysis call is unaffected.
   - Stop. Verify with the user that the engine works in lab mode and the live page still works.

2. **Page shell and ticker selection.**
   - Add the **Comp Lab** item to the main navigation.
   - Build the empty state (state A) with the ticker search field.
   - Wire up the ticker search to load a stock and progress to state B.
   - Stop. Verify the empty state, the ticker search behaviour, and the navigation.

3. **Setup chart.**
   - Render the interactive candlestick chart with EMA 20, EMA 50, SMA 200 overlays.
   - Implement click-to-select-candle (with green-fill marker) and click-to-deselect.
   - Add the date input field; sync bidirectionally with chart candle selection.
   - Grey out invalid dates in the date picker.
   - Stop. Verify the chart, the candle marker behaviour, the date input sync, and the invalid-date handling.

4. **Comp grid — static rendering.**
   - When a reference date is selected, call the comp engine in lab mode and render the comp grid: 2-per-row, 10 per page, Show More pagination.
   - Each card shows mini chart, date, signature, similarity score, outcome label. No rating control yet.
   - Implement the controls row (date display, sort toggle, legend, match count).
   - Implement the empty state for zero comps.
   - Stop. Verify the grid renders correctly across multiple stocks and dates, including a zero-comp case.

5. **Mini-chart modal.**
   - Clicking a mini chart opens the full interactive modal.
   - The modal shows the comp's full chart with all MA overlays, the comp candle marked green, full pan/zoom.
   - Close with X button or Escape key.
   - Stop. Verify the modal opens, behaves correctly, and closes cleanly.

6. **Rating control + Supabase wiring.**
   - Add the 1–5 rating buttons to each comp card.
   - Implement save-on-click to the `comp_ratings` table.
   - Pre-fill prior ratings on grid load.
   - Add the `Rated` badge to cards with prior ratings.
   - Handle save failures with the inline error described in Section 10.
   - Stop. Verify ratings save, pre-fill, update, and survive across sessions and devices.

7. **Persistence and polish.**
   - Implement within-day search persistence (Section 4).
   - Cross-device verification — confirm ratings sync via Supabase between two devices.
   - Final visual polish to match the platform theme.
   - End-to-end test: full workflow on a new stock, rating multiple comps, navigating away and back, switching devices.

---

## 14. Notes for the developer

- **The lookahead-bias rule is non-negotiable.** Any code path that lets data from on-or-after the reference date influence the result silently destroys the tool's value. Enforce at the data layer, not as a post-filter. Add the test.
- **Reuse the engine; don't fork it.** The Lab is a second interface onto the existing engine. The only change to the engine itself is the lab-mode parameter.
- **Ratings rate match quality, not outcome.** This discipline must be reinforced in the UI (the legend) and protected in the data model (we don't store any rating-of-outcome separately because it's not a thing we want to encourage). The phrase "ignore the outcome" must appear literally in the legend.
- **No auto-tuning.** The engine is never modified by an individual rating, and is never modified at all in v1. Improvement happens through deliberate, human-driven config changes informed by accumulated rating data, in a future iteration. The v2 process is gated by two minimum sample thresholds — **100 total ratings** before any tuning runs, and **20 per pattern** before any individual feature is adjusted (Section 11). These are not enforced in v1 code but are documented now so v2 starts from the right place. Do not build any feedback loop that modifies engine behaviour automatically, and do not propose any tuning logic that ignores the thresholds.
- **Charts: dynamic for the setup, static for the comps.** This is deliberate — the setup chart is for careful study; the comp grid is for rapid rating. Don't make the comp mini-charts interactive in v1; it'll slow the page and degrade the workflow.

---

## 15. Reference mockup description

A reference layout for Cursor to match (no code, just a description):

- Top: header nav with `Comp Lab` active.
- Below header, the page title and a short description: "Calibration and research tool for the comp engine."
- A ticker search input, prominent, centred-leftward, with a small "Last searched: AMD (2024-03-15)" link below if a recent search exists for today.
- (Once a stock loads) The interactive setup chart, full page width, ~400px tall, with EMA 20 / EMA 50 / SMA 200 lines clearly visible. Date input field to the right of the chart's title or above the chart.
- (Once a date is selected) Controls row: date display · `Sort: [Similarity | Recent]` toggle · rating legend in muted text · "23 comps found · 7 rated".
- The comp grid: 2 columns of cards, generous spacing. Each card ~320px wide, ~360px tall. Mini chart fills the top ~60% of the card. Date, signature, similarity score, and outcome label arranged compactly below. Rating buttons (1 2 3 4 5) at the bottom of the card, evenly spaced.
- At the bottom of the grid, the `Show More` button, centred, with text "Show 10 more (13 remaining)" or similar.
