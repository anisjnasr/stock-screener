# Go live on GitHub – step-by-step

Follow these steps to put the Stock Scanner repo on GitHub and deploy it.

---

## Step 1: Create a GitHub repository

1. Open [github.com/new](https://github.com/new).
2. Set **Repository name** (e.g. `stock-tool` or `stock-scanner`).
3. Choose **Public**.
4. Do **not** add a README, .gitignore, or license (you already have them).
5. Click **Create repository**.

---

## Step 2: Push your code

In your project folder (where this repo is cloned), run:

```powershell
# Add GitHub as the remote (replace YOUR_USERNAME and REPO_NAME with yours)
git remote add origin https://github.com/YOUR_USERNAME/REPO_NAME.git

# Or with SSH:
# git remote add origin git@github.com:YOUR_USERNAME/REPO_NAME.git

# Push the current branch (master or main)
git push -u origin master
```

If your default branch is `main`:

```powershell
git push -u origin main
```

After this, CI will run on every push (see `.github/workflows/ci.yml`).

---

## Step 3: Deploy the app

### Option A: Render (recommended)

1. Go to [dashboard.render.com](https://dashboard.render.com) → **New** → **Blueprint**.
2. Connect your GitHub account and select this repo.
3. Render will read `render.yaml` and create a Web Service.
4. In the service **Environment** tab, add:
   - `MASSIVE_API_KEY` = your Polygon/Massive API key (mark as **Secret**).
5. Deploy. When the service is running, open **Shell** and run the one-time DB setup:

   ```bash
   npm run init-screener-db
   npm run seed-companies
   ```

6. (Optional) To keep data fresh, add a [scheduled job](https://render.com/docs/cronjobs) or run `npm run refresh-safe` on a schedule (see [DEPLOY.md](DEPLOY.md#5-schedule-the-screener-refresh-scripts)).

### Option B: Railway

1. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub**.
2. Select this repo.
3. Add a **Volume**, mount path: `./data`.
4. In **Variables**, set `MASSIVE_API_KEY`.
5. Deploy, then in the **Shell** (or one-off run) execute:

   ```bash
   npm run init-screener-db
   npm run seed-companies
   ```

---

## Step 4: Open your live site

Use the URL Render or Railway gives you (e.g. `https://stock-scanner.onrender.com`). Set a custom domain in the dashboard if you want.

---

## Checklist

- [ ] GitHub repo created and code pushed.
- [ ] Remote added and `git push` succeeded.
- [ ] Deploy platform chosen (Render or Railway).
- [ ] `MASSIVE_API_KEY` set in the service environment.
- [ ] One-time DB setup run in the platform Shell (`init-screener-db`, `seed-companies`).
- [ ] (Optional) Refresh scheduled (e.g. daily) – see [DEPLOY.md](DEPLOY.md#5-schedule-the-screener-refresh-scripts).
- [ ] Run `npm run go-live:check` locally or on host.
- [ ] Confirm `GET /api/health` returns `status: "ok"` on the deployed site.

For more detail (Docker, VPS, cron examples), see [DEPLOY.md](DEPLOY.md).
