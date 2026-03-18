# GitHub Actions: Daily Data Refresh Setup

The **Daily Data Refresh** workflow runs at **2am ET** (Tue–Sat) to fetch the latest market data and recompute indicators. It uses GitHub’s cache to store the SQLite DB between runs so your app’s data stays current without running anything on your own machine.

For host-side manual refreshes, prefer `npm run refresh-safe` so the active DB is only replaced after verification succeeds.

---

## Quick start

1. **MASSIVE_API_KEY** – Add as a repo secret (Settings → Secrets → Actions).
2. **Runner** – Run `npm run setup-github-runner`, get the token from Settings → Actions → Runners → New self-hosted runner, paste when prompted.
3. **Seed** – Actions → Daily Data Refresh → Run workflow, set **Seed DB path** to `C:\Users\USER\stock-tool\data\screener.db` (or your path).

After the first run, the cache is populated and scheduled runs continue automatically.

---

## Prerequisites

- **MASSIVE_API_KEY** added as a repository secret: **Settings → Secrets and variables → Actions → New repository secret** (name: `MASSIVE_API_KEY`, value: your Polygon API key).
- A **self-hosted runner** (only for the one-time seed step; you can remove it afterward).

---

## Step 1: Add a self-hosted runner (one-time)

### Option A: Automated (recommended)

From the repo root, run:

```powershell
npm run setup-github-runner
```

The script will:
- Download the GitHub Actions runner
- Extract it to `%USERPROFILE%\actions-runner`
- Prompt you for the runner token
- Configure and optionally start the runner

**Before running**, get the token:
1. Go to **Settings → Actions → Runners** in your repo.
2. Click **New self-hosted runner**.
3. Copy the token from the **Configure** step (it expires in ~1 hour).
4. Run `npm run setup-github-runner` and paste the token when prompted.

To install the runner as a Windows service (starts with Windows):

```powershell
npm run setup-github-runner -- -InstallAsService
```

### Option B: Manual

1. In your repo go to **Settings → Actions → Runners**.
2. Click **New self-hosted runner**.
3. Select **Windows** and **x64** (or your OS/arch).
4. Run the commands GitHub shows (download, extract, configure, start). Use the default runner group unless you need another.
5. Start the runner (e.g. run `run.cmd` in the runner folder, or install as a service). Keep it running until the first workflow run finishes.

---

## Step 2: Seed the cache (one-time)

1. Go to **Actions → Daily Data Refresh**.
2. Click **Run workflow** (dropdown next to “Run workflow”).
3. Set **Seed DB path** to the **full path** to your `screener.db` on the machine where the runner is running, for example:
   - Windows: `C:\Users\USER\stock-tool\data\screener.db`
   - (Use the real path where the file lives on that PC.)
4. Leave **Also refresh financials** and **Skip daily bars refresh** unchecked (or set as you like).
5. Click the green **Run workflow** button.

Because **Seed DB path** is set, the job will run on your **self-hosted** runner. It will:

- Copy `screener.db` from that path into the workflow’s `data/` directory.
- Run the daily refresh (and optional financials if you checked that).
- **Save** the updated DB into the GitHub Actions cache.
- Upload the DB as an artifact (for deployment if you use it).

That run **populates the cache**.

---

## Step 3: After the first run

- **Scheduled runs** (2am ET Tue–Sat) use **GitHub-hosted** runners: they **restore** the DB from cache, run the refresh, then save back to cache. Your PC does not need to be on.
- You can **stop or remove** the self-hosted runner after the first successful seed if you only want cloud runs.
- To run the workflow by hand (e.g. to refresh financials), use **Run workflow** and leave **Seed DB path** blank so it uses the cached DB on GitHub-hosted runners.

---

## Manual run options

When you click **Run workflow** you can set:

| Input | Description |
|--------|-------------|
| **Seed DB path** | First-time only: path to `screener.db` on the runner machine. Use with a self-hosted runner. Leave empty after cache is seeded. |
| **Also refresh financials** | Run `refresh-financials` (quarterly data) in addition to daily bars and indicators. |
| **Skip daily bars refresh** | Skip the daily bars/indicators step (e.g. if you only want to run optimize or financials). |

---

## Troubleshooting

- **“No cached screener.db found”**  
  The cache is empty. Run the workflow once with **Seed DB path** set and a self-hosted runner as in Step 2.

- **Runner doesn’t pick up the job**  
  Ensure the self-hosted runner is running and in the default (or selected) runner group. Check **Settings → Actions → Runners** for status.

- **Copy step fails**  
  Check that **Seed DB path** is exact (including drive letter and backslashes on Windows) and that the file exists on the runner machine.

- **Scheduled run fails**  
  Ensure at least one successful run with **Seed DB path** has completed so the cache exists. Scheduled runs use **ubuntu-latest** and restore from cache.
