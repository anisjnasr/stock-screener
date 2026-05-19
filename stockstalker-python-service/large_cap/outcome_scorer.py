"""
Score pending Trade archive rows from daily OHLC (blueprint §11d).

Pure Python — no Claude. Uses local screener.db daily_bars only.
"""

from __future__ import annotations

import sqlite3
from datetime import datetime
from typing import Any, Literal, Optional
from zoneinfo import ZoneInfo

from large_cap.digest_builder import screener_db_path
from large_cap.supabase_archive import SupabaseArchiveError

ET = ZoneInfo("America/New_York")

Outcome = Literal["Scenario 1", "Scenario 2", "Scenario 3", "None", "Ambiguous"]
ScenarioClass = Literal[
    "did_not_trigger",
    "confirmed_occurred",
    "confirmed_did_not_occur",
    "unresolvable",
]


def _level_reached(level: float, day_low: float, day_high: float) -> bool:
    return day_low <= level <= day_high


def _scenario_class(
    trigger_reached: bool,
    target_reached: bool,
    invalidation_reached: bool,
) -> ScenarioClass:
    if not trigger_reached:
        return "did_not_trigger"
    if target_reached and not invalidation_reached:
        return "confirmed_occurred"
    if invalidation_reached and not target_reached:
        return "confirmed_did_not_occur"
    if target_reached and invalidation_reached:
        return "unresolvable"
    # Trigger reached, neither target nor invalidation — treat as did not occur path
    return "confirmed_did_not_occur"


def score_scenario_against_bar(
    scenario: dict[str, Any],
    bar: dict[str, float],
) -> dict[str, Any]:
    levels = scenario.get("key_levels") or {}
    trigger = float(levels["trigger"])
    target = float(levels["target"])
    invalidation = float(levels["invalidation"])
    lo = float(bar["low"])
    hi = float(bar["high"])

    trigger_reached = _level_reached(trigger, lo, hi)
    target_reached = _level_reached(target, lo, hi)
    invalidation_reached = _level_reached(invalidation, lo, hi)
    classification = _scenario_class(trigger_reached, target_reached, invalidation_reached)

    return {
        "rank": scenario.get("rank"),
        "trigger_reached": trigger_reached,
        "target_reached": target_reached,
        "invalidation_reached": invalidation_reached,
        "classification": classification,
    }


def determine_outcome(scenario_scores: list[dict[str, Any]]) -> Outcome:
    confirmed = [
        s for s in scenario_scores if s.get("classification") == "confirmed_occurred"
    ]
    if len(confirmed) == 1:
        rank = int(confirmed[0].get("rank") or 0)
        return f"Scenario {rank}"  # type: ignore[return-value]
    if len(confirmed) > 1:
        best = min(confirmed, key=lambda s: int(s.get("rank") or 99))
        rank = int(best.get("rank") or 0)
        return f"Scenario {rank}"  # type: ignore[return-value]

    if any(s.get("classification") == "unresolvable" for s in scenario_scores):
        return "Ambiguous"

    return "None"


def score_trade_result_json(
    result_json: dict[str, Any],
    bar: dict[str, float],
) -> dict[str, Any]:
    """Return {outcome, scoring_json} for one archive row."""
    scenarios = result_json.get("scenarios") or []
    if not isinstance(scenarios, list) or len(scenarios) == 0:
        raise ValueError("Trade result_json must include scenarios")

    per_scenario = [score_scenario_against_bar(s, bar) for s in scenarios]
    outcome = determine_outcome(per_scenario)
    return {
        "outcome": outcome,
        "scoring_json": {
            "scored_session_bar": bar,
            "scenarios": per_scenario,
        },
    }


def _connect() -> sqlite3.Connection:
    path = screener_db_path()
    if not path.exists():
        raise FileNotFoundError(f"Screener database not found: {path}")
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    return conn


def next_session_date_after(ticker: str, trading_date: str) -> Optional[str]:
    """First daily_bars date strictly after trading_date for ticker."""
    sym = ticker.strip().upper()
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT date FROM daily_bars
            WHERE ticker = ? AND date > ?
            ORDER BY date ASC LIMIT 1
            """,
            (sym, trading_date.strip()),
        ).fetchone()
    return str(row["date"]) if row else None


def fetch_daily_bar(ticker: str, session_date: str) -> Optional[dict[str, float]]:
    sym = ticker.strip().upper()
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT open, high, low, close FROM daily_bars
            WHERE ticker = ? AND date = ?
            """,
            (sym, session_date.strip()),
        ).fetchone()
    if not row:
        return None
    return {
        "open": float(row["open"]),
        "high": float(row["high"]),
        "low": float(row["low"]),
        "close": float(row["close"]),
        "date": session_date.strip(),
    }


def prior_completed_session_before(analysis_date: str) -> str:
    """Latest daily_bars date strictly before analysis_date (any ticker proxy via max date)."""
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT MAX(date) AS d FROM daily_bars WHERE date < ?
            """,
            (analysis_date.strip(),),
        ).fetchone()
    if not row or not row["d"]:
        raise ValueError(f"No completed session before {analysis_date}")
    return str(row["d"])


def should_score_row(trading_date: str, analysis_date: str, outcome_session: Optional[str]) -> bool:
    """
    Score when outcome session exists and is fully complete before today's analysis session.
    Never score using the current analysis_date session.
    """
    if not outcome_session:
        return False
    if outcome_session >= analysis_date.strip():
        return False
    prior = prior_completed_session_before(analysis_date)
    return outcome_session <= prior


def score_archive_row_if_ready(
    result_json: dict[str, Any],
    ticker: str,
    trading_date: str,
    analysis_date: str,
) -> Optional[dict[str, Any]]:
    """
    If the next session after trading_date is complete, return score payload; else None (stay pending).
    """
    outcome_session = next_session_date_after(ticker, trading_date)
    if not should_score_row(trading_date, analysis_date, outcome_session):
        return None
    bar = fetch_daily_bar(ticker, outcome_session)
    if not bar:
        return None
    scored = score_trade_result_json(result_json, bar)
    scored["outcome_session"] = outcome_session
    return scored
