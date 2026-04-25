# Phase 4 — Newsletter ingest + daily macro writeup (operator)

## 1. Supabase SQL

In the Supabase SQL Editor, run:

`data/supabase-newsletter-macro.sql`

This creates `newsletter_archive` (service role only) and `daily_macro_writeup` (public read via RLS for the Pre-market UI).

## 2. Google Cloud + Gmail OAuth (one-time)

1. Create a Google Cloud project → enable **Gmail API**.
2. Configure **OAuth consent** (External / Testing) and add yourself as a test user.
3. Create **OAuth client ID** → type **Web application**; add redirect URI `**https://developers.google.com/oauthplayground`** (used only to mint tokens).
4. In **[OAuth 2.0 Playground](https://developers.google.com/oauthplayground/)** (gear → use your own credentials), authorize `**https://www.googleapis.com/auth/gmail.readonly`**, exchange code, copy **refresh token**.
5. Store in production (and `.env.local` for dev):

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GMAIL_REFRESH_TOKEN`

## 3. Repo allowlist

Approved senders live in `config/newsletters-for-writeups.txt` (one email per line). Edit in git when your subscriptions change.

**Render / standalone builds:** the runtime bundle may not include that file path. The app **falls back to an embedded copy** of the same list (see `src/lib/premarket/newsletter-allowlist.ts`) so ingest still works. After you edit the text file, update the embedded string in that source file too (or set optional env `**NEWSLETTER_ALLOWLIST`** as comma-separated emails).

## 4. Anthropic + cron auth

- `ANTHROPIC_API_KEY` — already used elsewhere; required for macro generation.
- `CRON_SECRET` — must match `Authorization: Bearer …` on cron POSTs (same as other crons).

## 5. GitHub Actions

**Scheduled weekday crons:**

- `.github/workflows/newsletter-ingest-cron.yml` — **02:00, 09:00, 10:00, 12:00 UTC** (**6:00 AM, 1:00 PM, 2:00 PM, 4:00 PM UAE time**).
- `.github/workflows/premarket-brief-pipeline.yml` — triggered automatically after a successful Newsletter ingest run.

**Timezone note:** UAE time is UTC+4 year-round, so these cron hours do not require DST rotation.

Repository secrets (same pattern as `economic-calendar-cron.yml`):

- `APP_BASE_URL` — production origin, no trailing slash
- `CRON_SECRET` — matches server env

## 6. Local smoke test (step 3)

With `.env.local` containing `CRON_SECRET`, `APP_BASE_URL` (production origin recommended), Gmail + Anthropic + Supabase service role on the **deployed** host:

```bash
npm run newsletter:pipeline:trigger
```

Same as running **ingest** then **macro** in order:

```bash
npm run newsletter:ingest:trigger
npm run newsletter:macro:trigger
```

Optional: `npm run newsletter:pipeline:trigger -- --url https://your-host.example.com` overrides `APP_BASE_URL`.

Optional body override (advanced): POST JSON `{"ymd":"2026-04-20"}` on each cron for a specific ET calendar date.

## 6b. GitHub verify (step 4)

1. Repo **Settings → Secrets and variables → Actions**: set `**APP_BASE_URL`**, `**CRON_SECRET**` (same values as production).
2. **Actions → Newsletter ingest → Run workflow**.
3. Confirm the follow-on **Premarket brief pipeline** run is green; check Pre-market context on the site.

## 7. Ingest window

Cron loads Gmail messages from roughly the last **2 days** up to the current refresh time, then keeps messages whose **From** address matches the allowlist. Macro, equities, and themes read that current 2-day archive when the pipeline runs.