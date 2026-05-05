# StockStalker Python microservice (Phase 12A)

Small **FastAPI** service for **per-ticker news** via **yfinance**, used by **Stocks in Play** (Phase 12) on the Next.js app.

## Endpoints

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
| `INTERNAL_API_KEY` | Yes | Shared secret; Next.js will use the same value as `PYTHON_SERVICE_KEY` when calling this service. |
| `PORT` | Auto | Set by Render; uvicorn listens on it. |

## Deploy on Render

1. **Blueprint:** This repo’s root `render.yaml` includes a second web service `stockstalker-python` with `rootDir: stockstalker-python-service`.
2. After first deploy, set **`INTERNAL_API_KEY`** in the Python service environment (Render dashboard → long random string).
3. On the **Next.js** service, set:
   - `PYTHON_SERVICE_URL` — public URL of this service (no trailing slash), e.g. `https://stockstalker-python.onrender.com`
   - `PYTHON_SERVICE_KEY` — **same value** as `INTERNAL_API_KEY`

## Next.js integration (Phase 12B)

- **Library:** `src/lib/python-service.ts` — `fetchPythonTickerNews()`, `isPythonServiceConfigured()`.
- **Usage path:** Gap scans call `fetchPythonTickerNews()` directly from server code when the News toggle is on.

## Limits

- Ticker batch capped at **40**; empty or invalid symbols are skipped.
- Failures per symbol return **[]** for that key without failing the whole request.
