"""
Large Cap batch run orchestrator (blueprint stage 7).

Concurrent per-ticker analysis with NDJSON streaming, per-row error isolation.
"""

from __future__ import annotations

import json
import logging
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Callable, Iterator, Literal, Optional

from large_cap.cached_analysis import run_large_cap_analysis_cached

logger = logging.getLogger(__name__)

DataMode = Literal["historical", "historical_premarket"]

DEFAULT_CONCURRENCY = 3
MAX_CONCURRENCY = 5
MAX_TICKERS_PER_RUN = 50

_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


def normalize_tickers(raw: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for item in raw:
        sym = str(item).strip().upper()
        if not sym or len(sym) > 12:
            continue
        if not sym.replace(".", "").replace("-", "").isalnum():
            continue
        if sym in seen:
            continue
        seen.add(sym)
        out.append(sym)
    return out


def clamp_concurrency(value: int | None) -> int:
    if value is None:
        return DEFAULT_CONCURRENCY
    try:
        n = int(value)
    except (TypeError, ValueError):
        return DEFAULT_CONCURRENCY
    return max(1, min(MAX_CONCURRENCY, n))


def _validate_profile_id(profile_id: str) -> str:
    pid = profile_id.strip()
    if not _UUID_RE.match(pid):
        raise ValueError("profile_id must be a UUID")
    return pid


def _validate_data_mode(data_mode: str) -> DataMode:
    mode = (data_mode or "historical").strip().lower()
    if mode not in ("historical", "historical_premarket"):
        raise ValueError("data_mode must be historical or historical_premarket")
    return mode  # type: ignore[return-value]


def _analyze_one(
    profile_id: str,
    ticker: str,
    data_mode: DataMode,
    *,
    analysis_date: Optional[str],
    premarket_snapshot: Optional[dict[str, Any]],
    force_refresh: bool,
    claude_model: Optional[str],
    expected_db_latest: Optional[str],
    analyze_fn: Callable[..., dict[str, Any]],
) -> dict[str, Any]:
    return analyze_fn(
        profile_id,
        ticker,
        data_mode,
        analysis_date=analysis_date,
        premarket_snapshot=premarket_snapshot,
        force_refresh=force_refresh,
        claude_model=claude_model,
        expected_db_latest=expected_db_latest,
    )


def iter_large_cap_run_events(
    profile_id: str,
    tickers: list[str],
    data_mode: DataMode,
    *,
    analysis_date: Optional[str] = None,
    premarket_snapshots: Optional[dict[str, dict[str, Any]]] = None,
    force_refresh: bool = False,
    claude_model: Optional[str] = None,
    expected_db_latest: Optional[str] = None,
    concurrency: int = DEFAULT_CONCURRENCY,
    analyze_fn: Callable[..., dict[str, Any]] | None = None,
) -> Iterator[dict[str, Any]]:
    """
    Yield NDJSON-serializable event dicts for a batch run.

    Events: run_started, row_result | row_error, run_complete.
    """
    pid = _validate_profile_id(profile_id)
    symbols = normalize_tickers(tickers)
    if not symbols:
        raise ValueError("At least one valid ticker is required")
    if len(symbols) > MAX_TICKERS_PER_RUN:
        raise ValueError(f"At most {MAX_TICKERS_PER_RUN} tickers per run (got {len(symbols)})")

    workers = clamp_concurrency(concurrency)
    snaps = premarket_snapshots or {}
    if analyze_fn is None:
        from large_cap import cached_analysis as _ca

        fn: Callable[..., dict[str, Any]] = _ca.run_large_cap_analysis_cached
    else:
        fn = analyze_fn

    yield {
        "type": "run_started",
        "total": len(symbols),
        "data_mode": data_mode,
        "concurrency": workers,
        "tickers": symbols,
    }

    ok_count = 0
    error_count = 0

    def worker(sym: str) -> tuple[str, dict[str, Any]]:
        snap = snaps.get(sym)
        result = _analyze_one(
            pid,
            sym,
            data_mode,
            analysis_date=analysis_date,
            premarket_snapshot=snap,
            force_refresh=force_refresh,
            claude_model=claude_model,
            expected_db_latest=expected_db_latest,
            analyze_fn=fn,
        )
        return sym, result

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(worker, sym): sym for sym in symbols}
        for fut in as_completed(futures):
            sym = futures[fut]
            try:
                _, result = fut.result()
                ok_count += 1
                yield {
                    "type": "row_result",
                    "ticker": sym,
                    "ok": True,
                    "cache_hit": result.get("cache_hit"),
                    "claude_call_made": result.get("claude_call_made"),
                    "digest_hash": result.get("digest_hash"),
                    "trading_date": result.get("trading_date"),
                    "data_mode": result.get("data_mode"),
                    "analyzed_at": result.get("analyzed_at"),
                    "digest": result.get("digest"),
                    "verdict": result.get("verdict"),
                    "archive_written": bool(result.get("archive_written")),
                }
            except Exception as e:
                error_count += 1
                msg = str(e).strip() or e.__class__.__name__
                logger.warning("large_cap_run row_error ticker=%s error=%s", sym, msg)
                yield {
                    "type": "row_error",
                    "ticker": sym,
                    "ok": False,
                    "error": msg,
                }

    yield {
        "type": "run_complete",
        "total": len(symbols),
        "ok_count": ok_count,
        "error_count": error_count,
    }


def encode_ndjson_event(event: dict[str, Any]) -> str:
    return json.dumps(event, separators=(",", ":"), default=str) + "\n"
