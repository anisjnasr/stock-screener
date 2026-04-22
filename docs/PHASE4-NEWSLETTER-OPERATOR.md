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

**One-click verify (after `APP_BASE_URL` + `CRON_SECRET` repo secrets exist):**

- GitHub → **Actions** → workflow **“Phase 4 newsletter verify”** → **Run workflow**  
- Runs **ingest** then **macro** in one job: `.github/workflows/newsletter-phase4-verify.yml`

**Scheduled weekday crons:**

- `.github/workflows/newsletter-ingest-cron.yml` — **11:00 UTC** (~7:00 AM Eastern during **EDT**).
- `.github/workflows/macro-writeup-cron.yml` — **11:05 UTC** (~7:05 AM Eastern during **EDT**).

**DST note:** US Eastern toggles between UTC−5 and UTC−4. If jobs drift relative to 7:00 AM ET, adjust cron hours seasonally (e.g. use `12` UTC instead of `11` during standard time) or switch to a runner that schedules in `America/New_York`.

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
2. **Actions → Phase 4 newsletter verify → Run workflow**.
3. Confirm green; check Pre-market **Today’s macro writeup** on the site.

## 7. Ingest window

Cron loads Gmail messages from roughly the last **2 days**, then keeps only those whose `internalDate` falls in **4:00–7:00 AM America/New_York** on the target `ymd`, and whose **From** address matches the allowlist.