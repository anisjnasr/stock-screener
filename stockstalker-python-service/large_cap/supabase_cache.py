"""Supabase read/write for `large_cap_analysis_cache` (service role only)."""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any, Literal, Optional
from urllib.parse import quote

import httpx

DataMode = Literal["historical", "historical_premarket"]

TABLE = "large_cap_analysis_cache"
HTTP_TIMEOUT = 30.0


def _eq_filter(value: str) -> str:
    """PostgREST filter value (UUID, ticker, date)."""
    return quote(value.strip(), safe="-._:")


class SupabaseCacheError(Exception):
    pass


def supabase_rest_config() -> tuple[str, str]:
    url = (os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").strip().rstrip("/")
    key = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    return url, key


def is_supabase_cache_configured() -> bool:
    url, key = supabase_rest_config()
    return bool(url and key)


def _headers(service_key: str, *, prefer: str | None = None) -> dict[str, str]:
    h = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
    }
    if prefer:
        h["Prefer"] = prefer
    return h


def get_cached_analysis(
    profile_id: str,
    ticker: str,
    trading_date: str,
) -> Optional[dict[str, Any]]:
    """
    Return cache row or None. Keys: verdict_json, digest_hash, data_mode, analyzed_at.
    """
    base, key = supabase_rest_config()
    if not base or not key:
        raise SupabaseCacheError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for cache")

    sym = ticker.strip().upper()
    pid = profile_id.strip()
    dt = trading_date.strip()

    url = (
        f"{base}/rest/v1/{TABLE}"
        f"?profile_id=eq.{_eq_filter(pid)}&ticker=eq.{_eq_filter(sym)}&trading_date=eq.{_eq_filter(dt)}"
        f"&select=verdict_json,digest_hash,data_mode,analyzed_at"
    )

    with httpx.Client(timeout=HTTP_TIMEOUT) as client:
        res = client.get(url, headers=_headers(key))
    if res.status_code == 404:
        return None
    if res.status_code >= 400:
        raise SupabaseCacheError(f"Supabase cache read HTTP {res.status_code}: {res.text[:400]}")

    rows = res.json()
    if not isinstance(rows, list) or not rows:
        return None
    row = rows[0]
    if not isinstance(row, dict):
        return None
    return row


def upsert_cached_analysis(
    profile_id: str,
    ticker: str,
    trading_date: str,
    *,
    verdict_json: dict[str, Any],
    digest_hash: str,
    data_mode: DataMode,
    analyzed_at: Optional[str] = None,
) -> str:
    """Upsert cache row; returns analyzed_at ISO string stored."""
    base, key = supabase_rest_config()
    if not base or not key:
        raise SupabaseCacheError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for cache")

    at = analyzed_at or datetime.now(timezone.utc).isoformat()
    sym = ticker.strip().upper()

    payload = {
        "profile_id": profile_id.strip(),
        "ticker": sym,
        "trading_date": trading_date.strip(),
        "verdict_json": verdict_json,
        "digest_hash": digest_hash,
        "data_mode": data_mode,
        "analyzed_at": at,
    }

    url = f"{base}/rest/v1/{TABLE}?on_conflict=profile_id,ticker,trading_date"

    with httpx.Client(timeout=HTTP_TIMEOUT) as client:
        res = client.post(
            url,
            headers=_headers(key, prefer="resolution=merge-duplicates,return=minimal"),
            json=payload,
        )
    if res.status_code >= 400:
        raise SupabaseCacheError(f"Supabase cache upsert HTTP {res.status_code}: {res.text[:400]}")
    return at
