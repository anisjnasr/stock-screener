"""Resolve Large Cap analysis session dates from screener.db coverage."""

from __future__ import annotations

import sqlite3
from datetime import date, datetime, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")


def ny_today_ymd() -> str:
    return datetime.now(ET).strftime("%Y-%m-%d")


def add_calendar_day_ymd(ymd: str) -> str:
    y, m, d = (int(x) for x in ymd.split("-"))
    return (date(y, m, d) + timedelta(days=1)).isoformat()


def get_latest_reliable_completed_date(conn: sqlite3.Connection) -> Optional[str]:
    """
    Latest daily_bars session with broad symbol coverage, strictly before NY calendar today.
    Mirrors the Next.js getLatestCompletedTradingDate() bar-coverage gate.
    """
    ny_today = ny_today_ymd()
    row = conn.execute("SELECT COUNT(*) FROM companies").fetchone()
    company_count = int(row[0]) if row else 0
    min_coverage = max(200, int(company_count * 0.8)) if company_count else 200

    rows = conn.execute(
        """
        SELECT date, COUNT(DISTINCT symbol) AS cnt
        FROM daily_bars
        WHERE date <= ?
        GROUP BY date
        ORDER BY date DESC
        LIMIT 30
        """,
        (ny_today,),
    ).fetchall()
    if not rows:
        return None
    for bar_date, cnt in rows:
        if int(cnt) >= min_coverage:
            return str(bar_date)
    return str(rows[0][0])


def resolve_analysis_date_ymd(
    conn: sqlite3.Connection,
    explicit: Optional[str] = None,
) -> str:
    """
    Session date the digest is for (premarket / today's trade plan).

    Must be strictly after the latest completed DB session so prior-day bars include
    the freshest EOD data. On the evening after daily refresh, calendar today can
    equal the new latest session — bump to the next calendar day for that case.
    """
    if explicit and explicit.strip():
        candidate = explicit.strip()
    else:
        candidate = ny_today_ymd()

    latest = get_latest_reliable_completed_date(conn)
    if not latest:
        return candidate

    min_analysis = add_calendar_day_ymd(latest)
    if candidate < min_analysis:
        return min_analysis
    return candidate


def assert_db_covers_latest(
    conn: sqlite3.Connection,
    expected_latest: Optional[str],
) -> None:
    """Raise when Python's screener.db is behind the main app's latest session."""
    if not expected_latest or not expected_latest.strip():
        return
    expected = expected_latest.strip()
    if len(expected) != 10:
        return
    our_latest = get_latest_reliable_completed_date(conn)
    if our_latest and our_latest < expected:
        raise ValueError(
            f"Screener DB is stale: latest session {our_latest}, expected at least {expected}. "
            "Sync screener.db to the Python service after daily refresh."
        )
