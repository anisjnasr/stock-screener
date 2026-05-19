"""Score pending archive rows before a batch run (blueprint §11d)."""

from __future__ import annotations

import logging
from typing import Any, Iterator, Optional

from large_cap.digest_builder import default_analysis_date_ymd
from large_cap.outcome_scorer import score_archive_row_if_ready
from large_cap.supabase_archive import (
    SupabaseArchiveError,
    list_pending_archive_rows,
    mark_archive_scored,
)

logger = logging.getLogger(__name__)


def iter_score_pending_archives(
    profile_id: str,
    *,
    analysis_date: Optional[str] = None,
) -> Iterator[dict[str, Any]]:
    """
    Yield archive_scored events for rows that can be scored on this run day.
    """
    as_of = (analysis_date or default_analysis_date_ymd()).strip()
    pending = list_pending_archive_rows(profile_id)
    scored_count = 0
    skipped_count = 0

    for row in pending:
        ticker = str(row.get("ticker") or "").strip().upper()
        trading_date = str(row.get("trading_date") or "").strip()
        result_json = row.get("result_json")
        if not ticker or not trading_date or not isinstance(result_json, dict):
            skipped_count += 1
            continue
        try:
            payload = score_archive_row_if_ready(result_json, ticker, trading_date, as_of)
        except FileNotFoundError as e:
            logger.warning("archive scoring skipped (no db): %s", e)
            yield {"type": "archive_scoring_skipped", "reason": str(e)}
            return
        except Exception as e:
            logger.warning(
                "archive scoring error ticker=%s trading_date=%s error=%s",
                ticker,
                trading_date,
                e,
            )
            yield {
                "type": "archive_score_error",
                "ticker": ticker,
                "trading_date": trading_date,
                "error": str(e),
            }
            continue

        if payload is None:
            skipped_count += 1
            continue

        mark_archive_scored(
            profile_id,
            ticker,
            trading_date,
            outcome=str(payload["outcome"]),
            scoring_json=payload["scoring_json"],
            outcome_session=str(payload["outcome_session"]),
        )
        scored_count += 1
        yield {
            "type": "archive_scored",
            "ticker": ticker,
            "trading_date": trading_date,
            "outcome_session": payload["outcome_session"],
            "outcome": payload["outcome"],
        }

    yield {
        "type": "archive_scoring_complete",
        "scored_count": scored_count,
        "skipped_still_pending": skipped_count,
        "analysis_date": as_of,
    }
