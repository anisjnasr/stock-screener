# Market events (policy / Fed) — production setup

This wires **scheduled ingest** for Fed calendar, Treasury auctions + press, White House sitemap, and USTR press into Supabase table **`market_events`**.

**Prerequisites:** same Supabase env vars as the economic calendar (`NEXT_PUBLIC_SUPABASE_*`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`) on your **web** service. See [ECONOMIC-CALENDAR-PRODUCTION.md](ECONOMIC-CALENDAR-PRODUCTION.md) Part A.

---

## 1) One-time SQL

In Supabase **SQL Editor**, run the full file:

[`data/supabase-market-events.sql`](../data/supabase-market-events.sql)

---

## 2) GitHub Actions (recommended)

Uses the **same** repository secrets as the economic calendar workflow:

| Secret | Value |
|--------|--------|
| `APP_BASE_URL` | Public origin only, e.g. `https://your-service.onrender.com` (no trailing slash) |
| `CRON_SECRET` | Exact match of `CRON_SECRET` on Render |

Workflow: **Market Events Ingest** — [`.github/workflows/market-events-cron.yml`](../.github/workflows/market-events-cron.yml)

- **Actions** → **Market Events Ingest** → **Run workflow** to verify after deploy.
- Default schedule: daily `0 7 * * *` UTC (edit the workflow file to change).

---

## 3) Smoke from your laptop

With `CRON_SECRET` in `.env.local` or the shell:

```powershell
npm run market-events:trigger -- --url https://your-service.onrender.com
```

Expect **HTTP 200** and `"ok": true` for each of the four POSTs.

---

## 4) Read API and UI

- `GET /api/market-events?from=YYYY-MM-DD&to=YYYY-MM-DD` — optional `impact`, `categories` (comma-separated).
- Pre-market **Calendars** section includes **Policy & Fed** (`KeyEvents.tsx`).

---

## 5) Optional: Render Cron

Same pattern as economic calendar: four `curl -X POST` jobs (or one shell script), each with `Authorization: Bearer $CRON_SECRET`.

Endpoints:

| Path |
|------|
| `/api/cron/market-events/fed` |
| `/api/cron/market-events/treasury` |
| `/api/cron/market-events/white-house` |
| `/api/cron/market-events/ustr` |

---

## Troubleshooting

- **401** — `CRON_SECRET` mismatch between client and server.
- **503** — missing or wrong `SUPABASE_SERVICE_ROLE_KEY` on the web service.
- **Fed ingest 500 mentioning Fed `HTTP 404` for a future month** — deploy includes the fix that **skips** Fed months not yet published (`fetchFedMonthlyHtml` returns `null` on 404); older builds failed when “next ET month” had no page on federalreserve.gov yet.
- **Empty Policy & Fed table** — run ingest at least once; confirm rows in Supabase **Table Editor** → `market_events`.
