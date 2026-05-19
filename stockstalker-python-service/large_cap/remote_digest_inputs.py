"""Fetch Large Cap digest SQL inputs from the main Stock Scanner app (remote DB mode)."""

from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request
from typing import Any, Optional


def _remote_enabled() -> bool:
    raw = (os.environ.get("SCREENER_DB_REMOTE") or "").strip().lower()
    return raw in ("1", "true", "yes")


def use_remote_screener_db() -> bool:
    """True when Python should not use a local screener.db."""
    if _remote_enabled():
        return True
    from large_cap.digest_builder import screener_db_path

    return not screener_db_path().is_file()


def _peer_config() -> tuple[str, str]:
    base = (os.environ.get("STOCK_SCANNER_APP_URL") or os.environ.get("STOCK_SCANNER_EXPORT_URL") or "").strip()
    if not base:
        raise ValueError(
            "STOCK_SCANNER_APP_URL is not configured on the Python service (main app URL for remote digest inputs)."
        )
    token = (os.environ.get("INTERNAL_API_KEY") or "").strip()
    if not token:
        raise ValueError("INTERNAL_API_KEY is not configured")
    return base.rstrip("/"), token


def fetch_digest_inputs(
    ticker: str,
    *,
    analysis_date: Optional[str] = None,
) -> dict[str, Any]:
    base, token = _peer_config()
    qs = urllib.parse.urlencode(
        {
            "ticker": ticker.strip().upper(),
            **({"analysis_date": analysis_date.strip()} if analysis_date and analysis_date.strip() else {}),
        }
    )
    url = f"{base}/api/internal/large-cap/digest-inputs?{qs}"
    req = urllib.request.Request(
        url,
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    if not payload.get("ok"):
        raise ValueError(str(payload.get("error") or "digest-inputs failed"))
    inputs = payload.get("inputs")
    if not isinstance(inputs, dict):
        raise ValueError("digest-inputs response missing inputs object")
    return inputs
