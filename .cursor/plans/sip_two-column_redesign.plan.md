---
name: SIP two-column redesign
overview: Two-column premarket UI (SIP cards + Top Movers), richer catalyst API with categories, and SIP session roll at 04:00 ET (prior session until 3:59am).
todos:
  - id: layout-grid
    content: Replace SIP/Gappers tabs with responsive 2-column grid; Top Movers filters in right column header area
  - id: sip-cards
    content: Implement SIP card stack (accent bar, gap %, price, ticker, company, badge, write-up) and remove SIP table from main column
  - id: catalyst-api
    content: "Extend POST /api/premarket/catalyst: JSON schema (summary 3-4 sentences, category, guidanceTone), parser, prompt, token limit"
  - id: client-state
    content: Typed catalyst map + v3 localStorage; badge style map; wire fetch + loading states
  - id: rename-copy
    content: Rename user-facing Top Gappers → Top Movers; preserve LS keys or migrate
  - id: cleanup-ledger
    content: Keep archive table working; remove or narrow unused SIP table column state if dead
  - id: archive-before-4am
    content: "Change premarket session roll to 04:00 ET: `getEtHour24(now) < 4` in premarket-ledger.ts; update comments and PreMarketWorkspace copy (3:00 → 4:00 AM Eastern); optional PREMARKET_SESSION_ROLL_HOUR_ET = 4"
---

# Two-column SIP + Top Movers (with archive timing)

## SIP session roll at 04:00 ET (requirement)

**Goal:** SIP stays on the **prior** session’s calendar key from midnight through **03:59 ET**; at **04:00 ET** the session key advances to the new ET calendar day and the completed session is archived (ledger + cleared working keys). This matches the usual **~4:00 AM** premarket start instead of rolling at 3:00 AM.

**Implementation (when executing):**

1. [`src/lib/premarket-ledger.ts`](src/lib/premarket-ledger.ts) — In `premarketSessionEtDateKey()`, change **`getEtHour24(now) < 3`** to **`< 4`**. Update file comments (`ACTIVE_PREMARKET_SESSION_KEY`, `premarketSessionEtDateKey` docblock) from 03:00 ET to **04:00 ET**.
2. **Optional:** `PREMARKET_SESSION_ROLL_HOUR_ET = 4` used in the comparison for clarity.
3. [`src/components/PreMarketWorkspace.tsx`](src/components/PreMarketWorkspace.tsx) — Update the archive `useEffect` comment (~421) and user-facing strings that say **3:00 AM Eastern** to **4:00 AM Eastern** (empty SIP hint ~1025, SIP Archive blurb ~1170).

**Behavior (same mechanism, new hour):**

- **On mount:** If `ACTIVE_PREMARKET_SESSION_KEY` ≠ current `premarketSessionEtDateKey()`, merge and clear old session keys.
- **Every 30s:** When `premarketSessionEtDateKey()` changes vs `sessionEtDateRef`, archive previous session and reset SIP state.

With the tab open, roll occurs within **~30 seconds after 04:00 ET**. With the tab closed, the next visit runs the mount archive when `active` lags.

**No separate server cron**; persistence is client localStorage + ledger.

---

## Rest of plan (summary)

- **Layout:** Remove tabs; two-column grid — left: SIP cards (top 10 by gap %), right: Top Movers table + display filters; rename Top Gappers → Top Movers.
- **Catalyst API:** Extend JSON with 3–4 sentence summary, category badge, `guidanceTone` for GUIDANCE; bump client storage key if shape changes.
- **News:** Continue Massive/Polygon reference news within existing ET window helpers.

See conversation for full UI/API details.
