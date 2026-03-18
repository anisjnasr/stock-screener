Stock Scanner – CANSLIM-style stock research inspired by MarketSurge. Built with Next.js and Tailwind.

## Deploy to production (go live)

Push your repo to **GitHub**, then deploy. **Step-by-step:** [docs/GO_LIVE.md](docs/GO_LIVE.md).

Deploy in one of these ways:

| Platform | How |
|----------|-----|
| **Render** | [New → Blueprint](https://dashboard.render.com/select-repo?type=blueprint), select this repo. Render will use the included `render.yaml`. Add **MASSIVE_API_KEY** in the service Environment, then run [one-time DB setup](docs/DEPLOY.md#2-one-time-create-and-populate-the-screener-db) via Shell. |
| **Railway** | [New → Deploy from GitHub](https://railway.app/new), select this repo. Add a **volume** mounted at `./data`, set **MASSIVE_API_KEY**, then run DB init/seed in the shell. See [docs/DEPLOY.md](docs/DEPLOY.md). |
| **Docker** | `docker build -t stock-scanner .` then run with a volume for `./data` and `MASSIVE_API_KEY`. See [docs/DEPLOY.md](docs/DEPLOY.md#4-docker-optional-but-portable). |

The app needs a **persistent `data/` directory** (for `screener.db`) and **scheduled refresh** (e.g. daily). Full checklist and alternatives (VPS, Fly.io, Vercel + hosted DB) are in **[docs/DEPLOY.md](docs/DEPLOY.md)**. To use **GitHub Actions** for daily refresh at 2am ET (no server cron needed), see **[docs/DATA-REFRESH-SETUP.md](docs/DATA-REFRESH-SETUP.md)**.

Before launch, run:

```bash
npm run go-live:check
```

Operational health endpoint: `GET /api/health`.

For production-safe refreshes that avoid partial DB writes, use:

```bash
npm run refresh-safe
```

This runs refreshes on a staged DB copy, verifies table health, and only then promotes changes.

---

## Getting Started

### 1. API key (required for live data)

Get an API key from [Massive (formerly Polygon.io)](https://polygon.io). Copy the example env file and add your key:

```bash
cp .env.example .env.local
```

Edit `.env.local` and set `MASSIVE_API_KEY=your_actual_key`. Never commit `.env.local`.

**Fund ownership (institutional holders):** Massive does not provide institutional holder data. The app will use SEC EDGAR 13F data when that is implemented (see PROJECT_PLAN.md). Until then, the sidebar shows "— funds" with an explanatory note.

### 2. Run the development server

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

See **[docs/DEPLOY.md](docs/DEPLOY.md)** for one-time DB setup, scheduling refresh scripts, and the full checklist.

The app tab title is set to **Stock Scanner** in `src/app/layout.tsx`. You can change the favicon by replacing `src/app/favicon.ico`.
