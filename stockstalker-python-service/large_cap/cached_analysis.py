"""
Large Cap single-stock analysis with Supabase hash cache (blueprint §8c).

Rebuild digest → hash → cache lookup → Claude on miss → upsert.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Literal, Optional

from large_cap.claude_synthesis import synthesize_large_cap_verdict
from large_cap.digest_builder import build_large_cap_digest
from large_cap.digest_hash import compute_digest_hash
from large_cap.supabase_cache import (
    SupabaseCacheError,
    get_cached_analysis,
    is_supabase_cache_configured,
    upsert_cached_analysis,
)

logger = logging.getLogger(__name__)

DataMode = Literal["historical", "historical_premarket"]

_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


def _validate_profile_id(profile_id: str) -> str:
    pid = profile_id.strip()
    if not _UUID_RE.match(pid):
        raise ValueError("profile_id must be a UUID")
    return pid


def run_large_cap_analysis_cached(
    profile_id: str,
    ticker: str,
    data_mode: DataMode,
    *,
    analysis_date: Optional[str] = None,
    premarket_snapshot: Optional[dict[str, Any]] = None,
    force_refresh: bool = False,
    claude_model: Optional[str] = None,
) -> dict[str, Any]:
    """
    One ticker: digest build, cache gate, optional Claude call, cache write.

    Logs ``large_cap_cache HIT`` or ``large_cap_cache MISS`` per blueprint §8c.
    """
    if not is_supabase_cache_configured():
        raise SupabaseCacheError(
            "Cache requires SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY"
        )

    pid = _validate_profile_id(profile_id)
    sym = ticker.strip().upper()
    if not sym:
        raise ValueError("ticker is required")

    digest = build_large_cap_digest(
        sym,
        data_mode,
        analysis_date=analysis_date,
        premarket_snapshot=premarket_snapshot,
    )

    trading_date = str(digest.get("identity", {}).get("analysis_date") or "").strip()
    if not trading_date:
        raise ValueError("digest missing identity.analysis_date")

    digest_hash = compute_digest_hash(digest)

    cache_hit = False
    claude_call_made = False
    verdict: dict[str, Any]
    analyzed_at: str

    cached = None if force_refresh else get_cached_analysis(pid, sym, trading_date)

    if cached and cached.get("digest_hash") == digest_hash:
        cache_hit = True
        claude_call_made = False
        verdict = cached["verdict_json"]
        analyzed_at = str(cached.get("analyzed_at") or "")
        logger.info(
            "large_cap_cache HIT profile_id=%s ticker=%s trading_date=%s digest_hash=%s",
            pid,
            sym,
            trading_date,
            digest_hash[:16],
        )
    else:
        cache_hit = False
        claude_call_made = True
        logger.info(
            "large_cap_cache MISS profile_id=%s ticker=%s trading_date=%s digest_hash=%s force_refresh=%s had_row=%s",
            pid,
            sym,
            trading_date,
            digest_hash[:16],
            force_refresh,
            cached is not None,
        )
        verdict = synthesize_large_cap_verdict(digest, model=claude_model)
        analyzed_at = upsert_cached_analysis(
            pid,
            sym,
            trading_date,
            verdict_json=verdict,
            digest_hash=digest_hash,
            data_mode=data_mode,
        )

    return {
        "cache_hit": cache_hit,
        "claude_call_made": claude_call_made,
        "digest_hash": digest_hash,
        "trading_date": trading_date,
        "data_mode": data_mode,
        "analyzed_at": analyzed_at,
        "digest": digest,
        "verdict": verdict,
    }
