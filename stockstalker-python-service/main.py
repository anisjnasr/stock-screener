"""
StockStalker Python microservice — news + Large Cap digest, Claude synthesis, Supabase cache.
GET /health  |  POST /news  |  POST /large-cap/digest  |  POST /large-cap/synthesize  |  POST /large-cap/analyze
"""

from __future__ import annotations

import os
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import anthropic
import yfinance as yf
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from large_cap.cached_analysis import run_large_cap_analysis_cached
from large_cap.claude_synthesis import synthesize_large_cap_verdict
from large_cap.digest_builder import build_large_cap_digest
from large_cap.supabase_cache import SupabaseCacheError

app = FastAPI(title="StockStalker Python", version="0.1.0")


@app.get("/")
def root() -> dict[str, object]:
    """Root URL for browser checks — core routes under /health, /news, /large-cap/digest."""
    return {
        "service": "stockstalker-python",
        "version": app.version,
        "endpoints": {
            "GET /health": "Liveness (no auth)",
            "POST /news": "Ticker news JSON (Bearer INTERNAL_API_KEY)",
            "POST /large-cap/digest": "Large Cap digest JSON (Bearer INTERNAL_API_KEY)",
            "POST /large-cap/synthesize": "Claude verdict from digest (Bearer INTERNAL_API_KEY, ANTHROPIC_API_KEY)",
            "POST /large-cap/analyze": "Digest + cache + Claude (Bearer INTERNAL_API_KEY, Supabase + Anthropic)",
            "GET /docs": "OpenAPI / Swagger UI",
        },
    }


MAX_TICKERS = 40
MIN_HOURS_BACK = 1
MAX_HOURS_BACK = 168
DEFAULT_HOURS_BACK = 24


def _require_internal_key(authorization: str | None) -> None:
    expected = (os.environ.get("INTERNAL_API_KEY") or "").strip()
    if not expected:
        raise HTTPException(status_code=503, detail="INTERNAL_API_KEY is not configured")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Unauthorized")
    token = authorization[7:].strip()
    if token != expected:
        raise HTTPException(status_code=401, detail="Unauthorized")


class NewsRequest(BaseModel):
    tickers: list[str] = Field(default_factory=list, description="Uppercase/lowercase symbols")
    hours_back: int = Field(default=DEFAULT_HOURS_BACK, ge=MIN_HOURS_BACK, le=MAX_HOURS_BACK)


class NewsItem(BaseModel):
    title: str
    publisher: Optional[str] = None
    published_at: Optional[int] = None
    link: Optional[str] = None
    type: Optional[str] = None


class NewsResponse(BaseModel):
    data: dict[str, list[NewsItem]]


class PremarketSnapshotIn(BaseModel):
    """Mapped from Massive snapshot row (`parseSnapshotTickerRow`) — see TS LargeCapPremarketQuotePayload."""

    last_price: float
    prev_close_from_snapshot: float
    gap_pct: float
    pm_volume: float
    avg_volume_baseline_shares: Optional[float] = None


class LargeCapDigestRequest(BaseModel):
    ticker: str = Field(..., description="Symbol, e.g. AAPL")
    data_mode: str = Field(default="historical", description="historical | historical_premarket")
    analysis_date: Optional[str] = Field(
        default=None,
        description="YYYY-MM-DD session date for this digest (Eastern); default today ET",
    )
    premarket_snapshot: Optional[PremarketSnapshotIn] = Field(
        default=None,
        description="Massive snapshot fields when data_mode includes pre-market",
    )


class LargeCapDigestResponse(BaseModel):
    ok: bool = True
    digest: dict[str, Any] = Field(default_factory=dict)
    error: Optional[str] = None


class LargeCapSynthesizeRequest(BaseModel):
    """Body: full digest JSON (e.g. from POST /large-cap/digest)."""

    digest: dict[str, Any] = Field(..., description="Large Cap digest object")
    model: Optional[str] = Field(default=None, description="Override Anthropic model id")


class LargeCapSynthesizeResponse(BaseModel):
    ok: bool = True
    verdict: dict[str, Any] = Field(default_factory=dict)
    error: Optional[str] = None


class LargeCapAnalyzeRequest(BaseModel):
    profile_id: str = Field(..., description="StockStalker profiles.id UUID")
    ticker: str = Field(..., description="Symbol, e.g. AAPL")
    data_mode: str = Field(default="historical", description="historical | historical_premarket")
    analysis_date: Optional[str] = Field(default=None, description="YYYY-MM-DD session date (Eastern)")
    premarket_snapshot: Optional[PremarketSnapshotIn] = None
    force_refresh: bool = Field(default=False, description="Bypass digest hash cache check")
    model: Optional[str] = Field(default=None, description="Optional Anthropic model override")


class LargeCapAnalyzeResponse(BaseModel):
    ok: bool = True
    cache_hit: bool = False
    claude_call_made: bool = False
    digest_hash: Optional[str] = None
    trading_date: Optional[str] = None
    data_mode: Optional[str] = None
    analyzed_at: Optional[str] = None
    digest: dict[str, Any] = Field(default_factory=dict)
    verdict: dict[str, Any] = Field(default_factory=dict)
    error: Optional[str] = None


def _normalize_ticker(raw: str) -> str | None:
    s = raw.strip().upper()
    if not s or len(s) > 12:
        return None
    if not s.replace(".", "").isalnum():
        return None
    return s


def _flatten_yf_news_row(item: dict[str, Any]) -> dict[str, Any]:
    """yfinance often returns { id, content: { title, pubDate, ... } }; normalize to one dict."""
    inner = item.get("content")
    if isinstance(inner, dict):
        base = dict(inner)
        base.setdefault("link", None)
        prov = inner.get("provider")
        if isinstance(prov, dict) and prov.get("displayName"):
            base.setdefault("publisher", prov.get("displayName"))
        for url_key in ("canonicalUrl", "clickThroughUrl"):
            u = inner.get(url_key)
            if isinstance(u, dict) and u.get("url") and not base.get("link"):
                base["link"] = u.get("url")
        return base
    return item


def _pub_to_unix(pub: Any) -> float | None:
    if isinstance(pub, (int, float)):
        v = float(pub)
        # Heuristic: ms vs s (Yahoo ISO strings parsed below are always s)
        if v > 1e12:
            v = v / 1000.0
        return v
    if isinstance(pub, str) and pub.strip():
        s = pub.strip().replace("Z", "+00:00")
        try:
            dt = datetime.fromisoformat(s)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.timestamp()
        except ValueError:
            return None
    return None


def _yf_news_to_items(raw: list[Any], cutoff_ts: float) -> list[NewsItem]:
    out: list[NewsItem] = []
    for item in raw or []:
        if not isinstance(item, dict):
            continue
        row = _flatten_yf_news_row(item)
        pub_ts = _pub_to_unix(row.get("providerPublishTime") or row.get("pubDate"))
        if pub_ts is not None and pub_ts < cutoff_ts:
            continue
        title = row.get("title") or row.get("headline") or ""
        if not isinstance(title, str) or not title.strip():
            continue
        link = row.get("link")
        publisher = row.get("publisher")
        typ = row.get("type") or row.get("contentType")
        pub_int: int | None
        if pub_ts is not None:
            pub_int = int(pub_ts)
        else:
            pub_int = None
        out.append(
            NewsItem(
                title=title.strip()[:500],
                publisher=str(publisher).strip()[:200] if publisher else None,
                published_at=pub_int,
                link=str(link).strip()[:2000] if link else None,
                type=str(typ).strip()[:80] if typ else None,
            )
        )
    return out


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/news", response_model=NewsResponse)
def post_news(
    req: NewsRequest,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
) -> NewsResponse:
    _require_internal_key(authorization)

    symbols = []
    for t in req.tickers:
        n = _normalize_ticker(t)
        if n and n not in symbols:
            symbols.append(n)
    if len(symbols) > MAX_TICKERS:
        raise HTTPException(
            status_code=400,
            detail=f"At most {MAX_TICKERS} tickers per request (got {len(symbols)})",
        )

    cutoff = datetime.now(timezone.utc) - timedelta(hours=req.hours_back)
    cutoff_ts = cutoff.timestamp()

    result: dict[str, list[NewsItem]] = {}
    for sym in symbols:
        try:
            news = yf.Ticker(sym).news or []
            if not isinstance(news, list):
                news = []
            result[sym] = _yf_news_to_items(news, cutoff_ts)
        except Exception:
            result[sym] = []
        # Light pacing to reduce upstream burst (yfinance is unofficial)
        time.sleep(0.05)

    return NewsResponse(data=result)


@app.post("/large-cap/digest", response_model=LargeCapDigestResponse)
def post_large_cap_digest(
    req: LargeCapDigestRequest,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
) -> LargeCapDigestResponse:
    """Return deterministic digest JSON from local screener.db (see large_cap/digest_builder.py)."""
    _require_internal_key(authorization)

    sym = _normalize_ticker(req.ticker)
    if not sym:
        raise HTTPException(status_code=400, detail="Invalid or empty ticker")

    mode = (req.data_mode or "historical").strip().lower()
    if mode not in ("historical", "historical_premarket"):
        raise HTTPException(
            status_code=400,
            detail="data_mode must be historical or historical_premarket",
        )
    try:
        snap_dict = req.premarket_snapshot.model_dump() if req.premarket_snapshot else None
        d = build_large_cap_digest(
            sym,
            mode,  # type: ignore[arg-type]
            analysis_date=req.analysis_date,
            premarket_snapshot=snap_dict,
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    return LargeCapDigestResponse(ok=True, digest=d, error=None)


@app.post("/large-cap/synthesize", response_model=LargeCapSynthesizeResponse)
def post_large_cap_synthesize(
    req: LargeCapSynthesizeRequest,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
) -> LargeCapSynthesizeResponse:
    """
    Run Claude on a pre-built digest. Requires ANTHROPIC_API_KEY on the server.
    Returns blueprint §9 JSON (validated); on failure returns ok=false without raising if you prefer —
    here we use HTTP errors for API transport issues.
    """
    _require_internal_key(authorization)

    if not req.digest or not isinstance(req.digest, dict):
        raise HTTPException(status_code=400, detail="digest must be a non-empty object")

    try:
        v = synthesize_large_cap_verdict(req.digest, model=req.model)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except anthropic.AuthenticationError as e:
        raise HTTPException(
            status_code=502,
            detail=f"Anthropic authentication failed (check ANTHROPIC_API_KEY): {e}",
        ) from e
    except anthropic.RateLimitError as e:
        raise HTTPException(status_code=429, detail=str(e)) from e
    except anthropic.APIStatusError as e:
        raise HTTPException(status_code=502, detail=f"Anthropic API error: {e}") from e
    except anthropic.APIConnectionError as e:
        raise HTTPException(status_code=503, detail=f"Anthropic connection error: {e}") from e
    except anthropic.APITimeoutError as e:
        raise HTTPException(status_code=504, detail=f"Anthropic timeout: {e}") from e
    except anthropic.AnthropicError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e

    return LargeCapSynthesizeResponse(ok=True, verdict=v, error=None)


@app.post("/large-cap/analyze", response_model=LargeCapAnalyzeResponse)
def post_large_cap_analyze(
    req: LargeCapAnalyzeRequest,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
) -> LargeCapAnalyzeResponse:
    """
    Build digest, compare digest hash to Supabase cache, call Claude on miss, upsert cache.
    Logs cache HIT/MISS (blueprint §8c).
    """
    _require_internal_key(authorization)

    sym = _normalize_ticker(req.ticker)
    if not sym:
        raise HTTPException(status_code=400, detail="Invalid or empty ticker")

    mode = (req.data_mode or "historical").strip().lower()
    if mode not in ("historical", "historical_premarket"):
        raise HTTPException(
            status_code=400,
            detail="data_mode must be historical or historical_premarket",
        )

    snap_dict = req.premarket_snapshot.model_dump() if req.premarket_snapshot else None

    try:
        result = run_large_cap_analysis_cached(
            req.profile_id,
            sym,
            mode,  # type: ignore[arg-type]
            analysis_date=req.analysis_date,
            premarket_snapshot=snap_dict,
            force_refresh=req.force_refresh,
            claude_model=req.model,
        )
    except SupabaseCacheError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except FileNotFoundError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except anthropic.AuthenticationError as e:
        raise HTTPException(
            status_code=502,
            detail=f"Anthropic authentication failed (check ANTHROPIC_API_KEY): {e}",
        ) from e
    except anthropic.RateLimitError as e:
        raise HTTPException(status_code=429, detail=str(e)) from e
    except anthropic.APIStatusError as e:
        raise HTTPException(status_code=502, detail=f"Anthropic API error: {e}") from e
    except anthropic.APIConnectionError as e:
        raise HTTPException(status_code=503, detail=f"Anthropic connection error: {e}") from e
    except anthropic.APITimeoutError as e:
        raise HTTPException(status_code=504, detail=f"Anthropic timeout: {e}") from e
    except anthropic.AnthropicError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e

    return LargeCapAnalyzeResponse(
        ok=True,
        cache_hit=result["cache_hit"],
        claude_call_made=result["claude_call_made"],
        digest_hash=result["digest_hash"],
        trading_date=result["trading_date"],
        data_mode=result["data_mode"],
        analyzed_at=result["analyzed_at"],
        digest=result["digest"],
        verdict=result["verdict"],
        error=None,
    )
