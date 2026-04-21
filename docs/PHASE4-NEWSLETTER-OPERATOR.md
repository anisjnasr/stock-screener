# Phase 4 — Newsletter ingest + daily macro writeup (operator)

## 1. Supabase SQL

In the Supabase SQL Editor, run:

`data/supabase-newsletter-macro.sql`

This creates `newsletter_archive` (service role only) and `daily_macro_writeup` (public read via RLS for the Pre-market UI).

## 2. Google Cloud + Gmail OAuth (one-time)

1. Create a Google Cloud project → enable **Gmail API**.
2. Configure **OAuth consent** (External / Testing) and add yourself as a test user.
3. Create **OAuth client ID** → type **Desktop** (or Web with `http://localhost` redirect if you prefer).
4. Run a one-time OAuth flow on your machine to obtain a **refresh token** for your Gmail account. (Use Google’s OAuth playground or a small local script with `googleapis` — many guides exist for “Gmail API refresh token desktop app”.)
5. Store in production (and `.env.local` for dev):

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GMAIL_REFRESH_TOKEN`

## 3. Repo allowlist

Approved senders live in `config/newsletters-for-writeups.txt` (one email per line). Edit in git when your subscriptions change.

## 4. Anthropic + cron auth

- `ANTHROPIC_API_KEY` — already used elsewhere; required for macro generation.
- `CRON_SECRET` — must match `Authorization: Bearer …` on cron POSTs (same as other crons).

## 5. GitHub Actions

Workflows:

- `.github/workflows/newsletter-ingest-cron.yml` — weekdays **11:00 UTC** (~7:00 AM Eastern during **EDT**).
- `.github/workflows/macro-writeup-cron.yml` — weekdays **11:05 UTC** (~7:05 AM Eastern during **EDT**).

**DST note:** US Eastern toggles between UTC−5 and UTC−4. If jobs drift relative to 7:00 AM ET, adjust cron hours seasonally (e.g. use `12` UTC instead of `11` during standard time) or switch to a runner that schedules in `America/New_York`.

Repository secrets (same pattern as `economic-calendar-cron.yml`):

- `APP_BASE_URL` — production origin, no trailing slash
- `CRON_SECRET` — matches server env

## 6. Local smoke test

With `.env.local` filled and `npm run dev`:

```bash
npm run newsletter:ingest:trigger
npm run newsletter:macro:trigger
```

Optional body override (advanced): POST JSON `{"ymd":"2026-04-20"}` to re-run for a specific ET calendar date.

## 7. Ingest window

Cron loads Gmail messages from roughly the last **2 days**, then keeps only those whose `internalDate` falls in **4:00–7:00 AM America/New_York** on the target `ymd`, and whose **From** address matches the allowlist.
