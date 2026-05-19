"""Supabase read/write for `large_cap_trade_archive` (Trade verdicts only, blueprint §11a)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

import httpx

from large_cap.supabase_cache import (
    SupabaseCacheError,
    _eq_filter,
    _headers,
    supabase_rest_config,
)

TABLE = "large_cap_trade_archive"
HTTP_TIMEOUT = 30.0


class SupabaseArchiveError(SupabaseCacheError):
    pass


def is_trade_verdict(verdict_json: dict[str, Any]) -> bool:
    return str(verdict_json.get("verdict") or "").strip() == "Trade"


def upsert_trade_archive(
    profile_id: str,
    ticker: str,
    trading_date: str,
    *,
    result_json: dict[str, Any],
    logged_at: Optional[str] = None,
) -> str:
    """
    Upsert one archive row for a Trade verdict. Outcome stays pending (scored=false).
    No-op caller should skip when verdict is not Trade.
    """
    if not is_trade_verdict(result_json):
        raise ValueError("upsert_trade_archive requires a Trade verdict")

    base, key = supabase_rest_config()
    if not base or not key:
        raise SupabaseArchiveError(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for archive"
        )

    at = logged_at or datetime.now(timezone.utc).isoformat()
    sym = ticker.strip().upper()
    now = datetime.now(timezone.utc).isoformat()

    payload = {
        "profile_id": profile_id.strip(),
        "ticker": sym,
        "trading_date": trading_date.strip(),
        "result_json": result_json,
        "outcome": None,
        "scoring_json": None,
        "scored": False,
        "outcome_scored_at": None,
        "logged_at": at,
        "updated_at": now,
    }

    url = f"{base}/rest/v1/{TABLE}?on_conflict=profile_id,ticker,trading_date"

    with httpx.Client(timeout=HTTP_TIMEOUT) as client:
        res = client.post(
            url,
            headers=_headers(key, prefer="resolution=merge-duplicates,return=minimal"),
            json=payload,
        )
    if res.status_code >= 400:
        raise SupabaseArchiveError(
            f"Supabase archive upsert HTTP {res.status_code}: {res.text[:400]}"
        )
    return at


def maybe_write_trade_archive(
    profile_id: str,
    ticker: str,
    trading_date: str,
    verdict_json: dict[str, Any],
) -> bool:
    """Write archive row when verdict is Trade; return True if written."""
    if not is_trade_verdict(verdict_json):
        return False
    upsert_trade_archive(profile_id, ticker, trading_date, result_json=verdict_json)
    return True


def list_archive_rows(
    profile_id: str,
    *,
    ticker: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    outcome: Optional[str] = None,
    limit: int = 500,
) -> list[dict[str, Any]]:
    """List archive rows for a profile, newest trading_date first."""
    base, key = supabase_rest_config()
    if not base or not key:
        raise SupabaseArchiveError(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for archive"
        )
    pid = profile_id.strip()
    parts = [
        f"{base}/rest/v1/{TABLE}",
        f"?profile_id=eq.{_eq_filter(pid)}",
        "&select=ticker,trading_date,result_json,outcome,scoring_json,scored,outcome_scored_at,logged_at,updated_at",
        "&order=trading_date.desc,ticker.asc",
    ]
    sym = (ticker or "").strip().upper()
    if sym:
        parts.append(f"&ticker=eq.{_eq_filter(sym)}")
    if date_from and date_from.strip():
        parts.append(f"&trading_date=gte.{_eq_filter(date_from.strip())}")
    if date_to and date_to.strip():
        parts.append(f"&trading_date=lte.{_eq_filter(date_to.strip())}")
    oc = (outcome or "").strip()
    if oc.lower() == "pending":
        parts.append("&scored=eq.false")
    elif oc:
        parts.append(f"&outcome=eq.{_eq_filter(oc)}")
    cap = max(1, min(1000, int(limit)))
    parts.append(f"&limit={cap}")
    url = "".join(parts)
    with httpx.Client(timeout=HTTP_TIMEOUT) as client:
        res = client.get(url, headers=_headers(key))
    if res.status_code >= 400:
        raise SupabaseArchiveError(
            f"Supabase archive list HTTP {res.status_code}: {res.text[:400]}"
        )
    rows = res.json()
    return rows if isinstance(rows, list) else []


def list_pending_archive_rows(profile_id: str) -> list[dict[str, Any]]:
    base, key = supabase_rest_config()
    if not base or not key:
        raise SupabaseArchiveError(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for archive"
        )
    pid = profile_id.strip()
    url = (
        f"{base}/rest/v1/{TABLE}"
        f"?profile_id=eq.{_eq_filter(pid)}&scored=eq.false"
        f"&select=ticker,trading_date,result_json"
    )
    with httpx.Client(timeout=HTTP_TIMEOUT) as client:
        res = client.get(url, headers=_headers(key))
    if res.status_code >= 400:
        raise SupabaseArchiveError(
            f"Supabase archive list HTTP {res.status_code}: {res.text[:400]}"
        )
    rows = res.json()
    return rows if isinstance(rows, list) else []


def mark_archive_scored(
    profile_id: str,
    ticker: str,
    trading_date: str,
    *,
    outcome: str,
    scoring_json: dict[str, Any],
    outcome_session: str,
) -> None:
    base, key = supabase_rest_config()
    if not base or not key:
        raise SupabaseArchiveError(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for archive"
        )
    now = datetime.now(timezone.utc).isoformat()
    sym = ticker.strip().upper()
    payload = {
        "outcome": outcome,
        "scoring_json": {**scoring_json, "outcome_session": outcome_session},
        "scored": True,
        "outcome_scored_at": now,
        "updated_at": now,
    }
    url = (
        f"{base}/rest/v1/{TABLE}"
        f"?profile_id=eq.{_eq_filter(profile_id.strip())}"
        f"&ticker=eq.{_eq_filter(sym)}"
        f"&trading_date=eq.{_eq_filter(trading_date.strip())}"
    )
    with httpx.Client(timeout=HTTP_TIMEOUT) as client:
        res = client.patch(url, headers=_headers(key, prefer="return=minimal"), json=payload)
    if res.status_code >= 400:
        raise SupabaseArchiveError(
            f"Supabase archive score update HTTP {res.status_code}: {res.text[:400]}"
        )
