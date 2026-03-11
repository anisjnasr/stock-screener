# Deploy Stock Scanner to a live website (with screener DB)

This app uses a **file-based SQLite** database at `data/screener.db` for the screener and historical data. To run it live with the screener working, you need a host that provides:

1. A **persistent volume** (or writable filesystem) for `data/screener.db`
2. A way to run **scheduled jobs** (cron) for daily/weekly refresh scripts
3. **Node** (or Docker) to run the Next.js app and the scripts

Good options: **Railway**, **Fly.io**, **Render** (with disk + worker), or a **VPS** (DigitalOcean, Linode, etc.).

---

## 0. Deploy from GitHub (quick path)

1. **Push your code to GitHub** (create a repo and push; ensure `.env*` and `data/*.db` are in `.gitignore`).

2. **Choose a host and connect the repo:**
   - **Render**: Dashboard → **New** → **Blueprint** → connect this repo. The repo’s `render.yaml` will create a Web Service with a persistent disk. In the service **Environment**, add `MASSIVE_API_KEY` (mark as secret). Open the service **Shell** and run the one-time DB setup below (Section 2).
   - **Railway**: **New Project** → **Deploy from GitHub** → select this repo. Add a **Volume** and mount it at `./data`. In **Variables** set `MASSIVE_API_KEY`. Use the **Shell** (or a one-off run) to run DB init and seed (Section 2).

3. **One-time DB setup** (Section 2) and **schedule refresh** (Section 5) still apply; do them on the host (Shell, cron, or worker).

---

## 1. Environment variables

Set on the host (for both the app and any job that runs refresh scripts):

| Variable          | Required | Description                                      |
|-------------------|----------|--------------------------------------------------|
| `MASSIVE_API_KEY` | Yes      | Polygon (Massive) API key from [polygon.io](https://polygon.io) |

Copy from `.env.example`: `cp .env.example .env.local` and fill in your key. On the server, set the same in the platform’s environment (e.g. Railway Variables, Fly.io secrets).

---

## 2. One-time: create and populate the screener DB

Run these **on the deployment target** (or a one-off job that has access to the same volume as the app). The working directory must be the project root so `data/` is available.

1. **Init the database**  
   ```bash
   npm run init-screener-db
   ```  
   Creates `data/screener.db` from `data/screener-schema.sql`.

2. **Seed companies (universe)**  
   ```bash
   npm run seed-companies
   ```  
   Fills the `companies` table. Requires `MASSIVE_API_KEY`.

3. **Optional: backfill history**  
   ```bash
   npm run backfill-historical-massive
   ```  
   Populates `daily_bars`, `financials`, `quote_daily`, etc. (e.g. 10 years). Use `--limit N` for a smaller test. After this, daily refresh keeps data current.

Ensure the same `data/` directory (and `data/screener.db`) is used by the Next.js app at runtime (e.g. via a mounted volume).

---

## 3. Deploy the Next.js app

- **Build**: `npm run build`
- **Run**: `npm run start` (or `next start`) with the app’s working directory set to the project root so `data/screener.db` is at `process.cwd()/data/screener.db`.
- Set `MASSIVE_API_KEY` in the app’s environment.
- Use the platform’s HTTPS URL (e.g. `*.railway.app`, `*.fly.dev`) or a custom domain to access the site from any device.

---

## 4. Docker (optional but portable)

A Dockerfile is included for a single deployable image. The DB file is **not** bundled; mount a volume at `/app/data`.

**Build:**
```bash
docker build -t stock-scanner .
```

Before the first run, create and populate the DB on the **host** (in the repo directory) so `./data/screener.db` exists:

```bash
npm run init-screener-db
npm run seed-companies
# optional: npm run backfill-historical-massive
```

**Run the app container** (mount the same `data/` directory):

```bash
docker run -p 3000:3000 \
  -v "$(pwd)/data:/app/data" \
  -e MASSIVE_API_KEY=your_key \
  stock-scanner
```

Open http://localhost:3000 (or the host’s public URL). Schedule refresh scripts on the host (cron) so they write to the same `./data/screener.db` that you mount into the container.

---

## 5. Schedule the screener refresh scripts

So the historical DB stays up to date:

| Script                | Suggested schedule   | Purpose                          |
|-----------------------|----------------------|----------------------------------|
| `npm run refresh-daily` | Daily (e.g. after market close) | Updates `daily_bars`, `quote_daily`, indicators |
| `npm run refresh-financials` | Weekly or on-demand   | Refreshes financials             |
| `npm run refresh-companies` | Weekly or on universe change | Refreshes company metadata       |

All need `MASSIVE_API_KEY` and read/write access to `data/screener.db`.

**Examples:**

- **Railway**: Add a cron job or a separate worker service that runs `node scripts/refresh-daily.mjs` (and others) on a schedule, with the same env and volume as the app.
- **Fly.io**: Use a machine with a volume; run cron inside the machine or a separate small machine that shares the volume and runs only the scripts.
- **VPS (e.g. system cron):**
  ```cron
  0 18 * * 1-5 cd /app && npm run refresh-daily
  ```
  Adjust path and timezone (e.g. 18:00 UTC weekdays).

---

## 6. Checklist before go-live

- [ ] `MASSIVE_API_KEY` set on the host (app and any job that runs scripts).
- [ ] `data/screener.db` exists and is readable by the Next.js process (and writable by refresh scripts).
- [ ] At least one run of init + seed (and optionally backfill) so the screener has data.
- [ ] Cron or scheduled job for `refresh-daily` (and optionally `refresh-financials` / `refresh-companies`).
- [ ] App is reachable over HTTPS at a public URL (platform default or custom domain).

---

## Alternative: Vercel + hosted database

The current screener reads from a **local file** (`data/screener.db`). Vercel’s serverless runtime has a read-only filesystem, so you cannot use this file there as-is.

To use Vercel for the app you would need to:

1. Migrate the screener from file-based SQLite to a **hosted SQL** service (e.g. Turso, Neon, PlanetScale).
2. Update `src/lib/screener-db.ts` to use that database.
3. Run init/seed/backfill and refresh scripts from elsewhere (e.g. GitHub Actions or a small worker) that write to the same hosted DB.

That path is not covered in this guide; the steps above assume a host with persistent disk and cron.
