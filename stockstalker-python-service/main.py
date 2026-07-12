"""
StockStalker Python microservice — yfinance ticker news.
GET /health  |  POST /news
"""

from __future__ import annotations

import os
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import yfinance as yf
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

app = FastAPI(title="StockStalker Python", version="0.1.0")


@app.get("/")
def root() -> dict[str, object]:
    """Root URL for browser checks — core routes under /health and /news."""
    return {
        "service": "stockstalker-python",
        "version": app.version,
        "endpoints": {
            "GET /health": "Liveness (no auth)",
            "POST /news": "Ticker news JSON (Bearer INTERNAL_API_KEY)",
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
