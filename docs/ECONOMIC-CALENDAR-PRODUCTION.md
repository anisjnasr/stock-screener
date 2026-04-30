# Economic calendar — production setup (step by step)

This guide wires **scheduled ingest** for US high-impact events (Forex Factory weekly XML → Supabase `economic_events`) and assumes the SQL in [`data/supabase-economic-events.sql`](../data/supabase-economic-events.sql) is already applied.

---

## Part A — Production web service (Render or other host)

Your **Next.js** process must have these **server** environment variables (names must match exactly).

| Variable | Where to get it |
|----------|-----------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → **Project Settings** → **API** → **Project URL** |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same page → **anon public** key |
| `SUPABASE_SERVICE_ROLE_KEY` | Same page → **service_role** key (never expose to the browser) |
| `CRON_SECRET` | Generate a long random string (e.g. `openssl rand -hex 32`). You will reuse this value for GitHub Actions in Part B. |

### A1. Render (Blueprint or existing Web Service)

1. Open [Render Dashboard](https://dashboard.render.com/) → select your **Web Service** (e.g. `stock-scanner`).
2. Go to **Environment**.
3. Click **Add Environment Variable** for each row in the table above (plus `MASSIVE_API_KEY` and disk paths if you already use them).
4. For a **new** Blueprint from this repo, [`render.yaml`](../render.yaml) lists the Supabase keys and `CRON_SECRET` with `sync: false` so Render prompts during creation; you can still add or edit them later under **Environment**.
5. Click **Save Changes**. Render will redeploy when the service restarts.

### A2. Verify the live app can ingest (from your PC)

1. Note your public origin, e.g. `https://your-service.onrender.com` (no trailing slash).
2. From the **repo root** on your machine:

   ```powershell
   npm run economic-calendar:trigger -- --url https://your-service.onrender.com
   ```

   Set `CRON_SECRET` in the shell **or** rely on the same value in `.env.local` (the script loads `.env.local` if present; it does **not** send `.env.local` to the server).

3. Expect **HTTP 200** and JSON like `{ "ok": true, "parsed": N, "upserted": ... }`.

If you get **401**, the `CRON_SECRET` you passed does not match production. If **503** mentions Supabase service role, `SUPABASE_SERVICE_ROLE_KEY` is missing or wrong on the host.

---

## Part B — GitHub Actions (daily cron, no Render add-on)

The workflow **Economic Calendar Ingest** ([`.github/workflows/economic-calendar-cron.yml`](../.github/workflows/economic-calendar-cron.yml)) POSTs to your **public** app URL once per day (UTC) and also ingests market policy events. Until you add secrets, **scheduled** runs exit successfully without calling your app; **manual** runs fail with a clear error.

### B1. Add repository secrets

1. Open your repo on GitHub → **Settings** → **Secrets and variables** → **Actions**.
2. Click **New repository secret**.
3. Add **`APP_BASE_URL`**: your public site origin only, e.g. `https://your-service.onrender.com` (no path, no trailing slash).
4. Add **`CRON_SECRET`**: the **exact same string** as `CRON_SECRET` on Render (Part A).

### B2. Confirm Actions can run

1. Go to **Actions** → workflow **Economic Calendar Ingest**.
2. Click **Run workflow** → **Run workflow**.
3. Open the run → job **ingest** should succeed and print HTTP `200` and JSON in the log.

If **require-secrets-on-dispatch** failed, one secret is missing or empty.

---

## Part C — Optional: Render Cron Job (instead of or in addition to GitHub)

Use this if you prefer everything on Render and do not want GitHub to call your URL.

1. Dashboard → **New** → **Cron Job**.
2. Connect the same repo (or use a minimal image); **Command** should perform a POST, for example:

   ```bash
   curl -sS -f -X POST "https://YOUR-SERVICE.onrender.com/api/cron/economic-calendar" -H "Authorization: Bearer $CRON_SECRET" -H "Accept: application/json"
   ```

3. Add environment variable **`CRON_SECRET`** on the cron service (same value as the web service).
4. Set **Schedule** (UTC), e.g. `30 6 * * *` (daily 06:30 UTC, same as the GitHub workflow).
5. Save and use **Trigger Run** once to verify.

---

## Part D — Quick reference

| Goal | Command / place |
|------|-------------------|
| Local smoke (dev server on 3000) | `npm run economic-calendar:trigger` |
| Smoke production from laptop | `npm run economic-calendar:trigger -- --url https://your-host` |
| Manual cloud cron | GitHub **Actions** → **Economic Calendar Ingest** → **Run workflow** |
| Read API (browser / app) | `GET /api/economic-events?impact=High` (uses anon key + RLS) |

---

## Troubleshooting

- **401 Unauthorized** — `Authorization` header must be exactly `Bearer <CRON_SECRET>` with the same secret as on the server.
- **503 Supabase service role** — set `SUPABASE_SERVICE_ROLE_KEY` on the **web** service, redeploy.
- **Empty calendar in UI** — run ingest at least once; confirm rows in Supabase **Table Editor** → `economic_events`.
- **GitHub workflow skipped** — `APP_BASE_URL` or `CRON_SECRET` not set; add both secrets (Part B).

For host-agnostic deployment notes, see [DEPLOY.md](DEPLOY.md) and the go-live checklist in [GO_LIVE.md](GO_LIVE.md).

**Related:** Fed / Treasury / White House / USTR → `market_events` is documented in [MARKET-EVENTS-PRODUCTION.md](MARKET-EVENTS-PRODUCTION.md) (same `APP_BASE_URL` and `CRON_SECRET` secrets).
