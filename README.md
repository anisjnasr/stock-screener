# Stock Analysis Tool

A web-based US equities, indices, and futures analysis platform for retail traders. Features a modular dashboard, watchlists, positions, instrument pages with fundamentals and charts, and AI-powered analysis subpages.

## Prerequisites

- **Node.js** (LTS) – [nodejs.org](https://nodejs.org)
- **Git** – [git-scm.com](https://git-scm.com)
- Accounts (all free tiers): **Vercel**, **Supabase**, **Finnhub**, **OpenAI**

## Setup

### 1. Install dependencies

```bash
cd stock-tool
npm install
```

### 2. Database (Supabase)

1. Create a project at [supabase.com](https://supabase.com).
2. In the SQL Editor, run the contents of `supabase/schema.sql`.
3. In Project Settings → API, copy **Project URL** and **service_role** key (keep this secret).

### 3. Environment variables

Copy the example file and fill in your keys:

```bash
cp .env.example .env.local
```

Edit `.env.local`:

- `FINNHUB_API_KEY` – from [finnhub.io](https://finnhub.io) (free tier).
- `OPENAI_API_KEY` – from [platform.openai.com](https://platform.openai.com).
- `SUPABASE_URL` – your Supabase project URL.
- `SUPABASE_SERVICE_KEY` – your Supabase service_role key.
- `APP_API_KEY` – a long random string (e.g. generate with `openssl rand -hex 32`). This is the access key you and your friends enter in the app.

### 4. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Enter your `APP_API_KEY` when prompted.

## Deployment (Vercel)

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
# Create a repo on GitHub, then:
git remote add origin https://github.com/YOUR_USERNAME/stock-tool.git
git push -u origin main
```

### 2. Deploy on Vercel

1. Go to [vercel.com](https://vercel.com) and sign in.
2. **Add New** → **Project** → import your GitHub repo.
3. In **Environment Variables**, add the same keys as in `.env.local`:
   - `FINNHUB_API_KEY`
   - `OPENAI_API_KEY`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_KEY`
   - `APP_API_KEY`
4. Deploy. Your app URL will be `https://your-project.vercel.app`.

### 3. Share with friends

- **Option A:** Share the same `APP_API_KEY`; they enter it once in the app (“Enter access key”).
- **Option B:** Use different keys by adding rows to the `api_keys` table and validating hashed keys in your API (see plan).

## Features

- **Dashboard:** Modular widgets (Indices, Chart, Watchlist, Positions, News). Create watchlists and position lists; add/remove/reorder widgets.
- **Search:** Global search bar; select a symbol to go to its instrument page.
- **Instrument page:** Profile, overview (price, market cap, float, earnings), chart, short statistics, institutional ownership, news. Short/institutional show “N/A” on free tier with a note.
- **AI subpages:** Predefined (Market positioning, Industry analysis, Competitors, Strengths & weaknesses, Earnings analysis) and custom prompts (create and save from the instrument nav). Prompts run when the subpage is opened.

## Data limits

- Finnhub free tier: 60 calls/minute. Data may be delayed.
- Short interest and institutional ownership are stubbed on free tier; upgrade your data plan to add real metrics.
