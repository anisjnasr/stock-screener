# StockStalker Python microservice (Phase 12A)

Small **FastAPI** service for **per-ticker news** via **yfinance**, used by **Stocks in Play** (Phase 12) on the Next.js app.

## Large Cap Analysis — digest (stage 2+)

Deterministic JSON digest from **`data/screener.db`** (OHLC + `indicators_daily` + `quote_daily`). No Claude calls here.

| Method | Path | Auth |
|--------|------|------|
| `POST` | `/large-cap/digest` | `Authorization: Bearer <INTERNAL_API_KEY>` |

Body:

```json
{
  "ticker": "AAPL",
  "data_mode": "historical",
  "analysis_date": null
}
```

- `data_mode`: `historical` (pre-market block omitted) or `historical_premarket` (pre-market object present; Polygon fill is stage 3).
- `analysis_date`: optional `YYYY-MM-DD` (Eastern calendar day for the session you are analyzing). Default: today in `America/New_York`.

**Local CLI** (no server; prints JSON to stdout):

```bash
cd stockstalker-python-service
python -m large_cap AAPL historical
python -m large_cap MSFT historical_premarket
python -m large_cap AAPL historical --as-of 2026-05-15
python -m large_cap AAPL historical --db "C:\path\to\screener.db"
```

Environment: `SCREENER_DB_PATH` overrides the DB file (otherwise `../data/screener.db` from this package).

**Historical analogues (stage 4):** `historical_analogues.py` scans prior sessions with the same deterministic signature rule documented in `matching_rule_summary` and `engine_constants` inside each digest.

When `data_mode` is `historical_premarket`, optional **`premarket_snapshot`** (JSON body) merges Massive mapped fields:

```json
{
  "last_price": 301.12,
  "prev_close_from_snapshot": 299.5,
  "gap_pct": 0.5409,
  "pm_volume": 1200000,
  "avg_volume_baseline_shares": 5500000
}
```

(`gap_pct` is informational; Python recomputes gap vs **database** prior close for consistency with key levels.)

## Large Cap Analysis — Claude synthesis (stage 5)

Uses the official **`anthropic`** Python SDK. The API key stays **server-side only** (`ANTHROPIC_API_KEY`). Default model **`claude-sonnet-4-6`** (override with `ANTHROPIC_LARGE_CAP_MODEL`, e.g. `claude-opus-4-7`).

| Method | Path | Auth |
|--------|------|------|
| `POST` | `/large-cap/synthesize` | `Authorization: Bearer <INTERNAL_API_KEY>` |

Body:

```json
{
  "digest": { },
  "model": null
}
```

- **`digest`**: full object returned by **`POST /large-cap/digest`** (or equivalent CLI output).
- **`model`**: optional Anthropic model id string.

Response **`verdict`** matches blueprint §9 (`ticker`, `verdict`, `verdict_reason`, `bias`, `narrative`, `scenarios`). Optional Markdown code fences around JSON are stripped before parse; validation failures return HTTP **400**.

### Anthropic setup (do this once)

1. **Account:** Open [console.anthropic.com](https://console.anthropic.com) and sign in (or create an account).
2. **Billing:** Add a payment method and enough **Prepaid credits** (or enabled billing) so API calls are allowed — usage is **pay-as-you-go** per token ([pricing](https://www.anthropic.com/pricing)).
3. **API key:** **Settings → API keys → Create Key**. Copy the secret **once** (you cannot view it again).
4. **Local Python service:** Before `uvicorn`, set the variable in your shell (examples):
   - **Windows CMD:** `set ANTHROPIC_API_KEY=sk-ant-api03-...`
   - **PowerShell:** `$env:ANTHROPIC_API_KEY="sk-ant-api03-..."`
   - Or add it to your env file used when starting the service (**never** commit the key to git).
5. **Render:** Dashboard → **`stockstalker-python`** service → **Environment** → **Add** `ANTHROPIC_API_KEY` with the same secret → Save (**Manual sync** so the value is not in the repo). Optionally set **`ANTHROPIC_LARGE_CAP_MODEL`** (defaults to Sonnet in `render.yaml`).
6. **Correct result:** `POST /large-cap/synthesize` returns **`200`** with `"ok": true` and a **`verdict`** object. **`502`** with “authentication” usually means a missing/wrong key; **`429`** means rate limit.

### Example (curl)

First fetch a digest, then synthesize (PowerShell):

```powershell
$hdr = @{ Authorization = "Bearer YOUR_INTERNAL_API_KEY"; "Content-Type" = "application/json" }
$d = Invoke-RestMethod -Method POST -Uri http://127.0.0.1:8000/large-cap/digest -Headers $hdr -Body '{"ticker":"AAPL","data_mode":"historical"}'
Invoke-RestMethod -Method POST -Uri http://127.0.0.1:8000/large-cap/synthesize -Headers $hdr -Body (@{ digest = $d.digest } | ConvertTo-Json -Depth 30)
```

## Large Cap Analysis — caching (stage 6)

Digest SHA-256 fingerprint + Supabase **`large_cap_analysis_cache`**. Unchanged digest for `(profile_id, ticker, trading_date)` skips Claude.

| Method | Path | Auth |
|--------|------|------|
| `POST` | `/large-cap/analyze` | `Authorization: Bearer <INTERNAL_API_KEY>` |

Requires **`SUPABASE_URL`** (or `NEXT_PUBLIC_SUPABASE_URL`) and **`SUPABASE_SERVICE_ROLE_KEY`** on the Python service. Logs **`large_cap_cache HIT`** or **`large_cap_cache MISS`**.

Set **`force_refresh`: true** to bypass the hash check (optional blueprint affordance).

**Next.js:** `POST /api/large-cap/analyze` with `{ profile_id, ticker, data_mode, force_refresh? }`.

## Endpoints (existing)

| Method | Path | Auth |
|--------|------|------|
| `GET` | `/health` | None |
| `POST` | `/news` | `Authorization: Bearer <INTERNAL_API_KEY>` |

### `POST /news` body

```json
{
  "tickers": ["AAPL", "MSFT"],
  "hours_back": 24
}
```

- **tickers**: max **40** symbols per request.
- **hours_back**: **1–168**, default **24**.

### Example (local)

```bash
cd stockstalker-python-service
python -m venv .venv
.venv\Scripts\activate   # Windows
pip install -r requirements.txt
set INTERNAL_API_KEY=dev-secret-32chars-minimum-please
uvicorn main:app --reload --port 8000
```

```bash
curl -s http://127.0.0.1:8000/health
curl -s http://127.0.0.1:8000/news -H "Authorization: Bearer dev-secret-32chars-minimum-please" ^
  -H "Content-Type: application/json" ^
  -d "{\"tickers\":[\"AAPL\"],\"hours_back\":48}"
```

## Environment (Render)

| Variable | Required | Description |
|----------|----------|-------------|
| `INTERNAL_API_KEY` | Yes | Shared secret; Next.js uses the same value as `PYTHON_SERVICE_KEY`. |
| `ANTHROPIC_API_KEY` | For `/large-cap/synthesize` | Claude API secret (`sync: false` in blueprint — set in dashboard). |
| `ANTHROPIC_LARGE_CAP_MODEL` | No | Default `claude-sonnet-4-6` in `render.yaml`; e.g. `claude-opus-4-7`. |
| `SUPABASE_URL` | For `/large-cap/analyze` cache | Same project URL as `NEXT_PUBLIC_SUPABASE_URL`. |
| `SUPABASE_SERVICE_ROLE_KEY` | For `/large-cap/analyze` cache | Service role key (never expose to browser). |
| `SCREENER_DB_PATH` | Yes on Render | Path to `screener.db` for Large Cap digest (`/app/data/screener.db` in `render.yaml`). |
| `SCREENER_DATA_DIR` | No | Data directory; default `/app/data` on Render. |
| `STOCK_SCANNER_APP_URL` | Yes on Render | Main app base URL (e.g. `https://stock-scanner.onrender.com`). Used to pull `screener.db` after the main app updates. |
| `PORT` | Auto | Set by Render; uvicorn listens on it. |

## Deploy on Render

1. **Blueprint:** This repo’s root `render.yaml` includes a second web service `stockstalker-python` with `rootDir: stockstalker-python-service` and a **30GB persistent disk** at `/app/data`.
2. After first deploy, set **`INTERNAL_API_KEY`**, **`ANTHROPIC_API_KEY`**, Supabase cache vars, and **`STOCK_SCANNER_APP_URL`** (main app URL) on the Python service environment (Render dashboard).
3. **DB sync:** After each main-app DB update (daily GitHub refresh or admin import), the main app triggers this service to download `screener.db` from `GET /api/admin/screener-db-export`. No manual copy is required once `STOCK_SCANNER_APP_URL` is set. First deploy still needs a successful daily refresh (or one manual `POST /api/admin/sync-python-db` on the main app) to populate the Python disk.
4. On the **Next.js** service, set:
   - `PYTHON_SERVICE_URL` — public URL of this service (no trailing slash), e.g. `https://stockstalker-python.onrender.com`
   - `PYTHON_SERVICE_KEY` — **same value** as `INTERNAL_API_KEY`

**Memory / disk:** Render Starter (512MB RAM) is tight for a ~6GB `screener.db` plus concurrent Large Cap runs. If you see OOM restarts, upgrade `stockstalker-python` to **Standard** (2GB+) or keep batch concurrency low (default 3). DB sync needs ~2× DB size free on the Python disk during download; prune failed syncs via `POST /admin/sync-screener-db` (automatic cleanup runs at sync start).

## Next.js integration (Phase 12B)

- **Library:** `src/lib/python-service.ts` — `fetchPythonTickerNews()`, `isPythonServiceConfigured()`.
- **Usage path:** Gap scans call `fetchPythonTickerNews()` directly from server code when the News toggle is on.

## Limits

- Ticker batch capped at **40**; empty or invalid symbols are skipped.
- Failures per symbol return **[]** for that key without failing the whole request.
