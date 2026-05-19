"""Tests for analysis session date resolution."""

from __future__ import annotations

import sqlite3
import unittest
from unittest.mock import patch

from large_cap.db_session_date import (
    add_calendar_day_ymd,
    assert_db_covers_latest,
    get_latest_reliable_completed_date,
    resolve_analysis_date_ymd,
)


class TestDbSessionDate(unittest.TestCase):
    def test_add_calendar_day(self) -> None:
        self.assertEqual(add_calendar_day_ymd("2026-05-18"), "2026-05-19")

    def test_latest_completed_date(self) -> None:
        conn = sqlite3.connect(":memory:")
        conn.executescript(
            """
            CREATE TABLE companies (symbol TEXT);
            CREATE TABLE daily_bars (symbol TEXT, date TEXT);
            INSERT INTO companies VALUES ('AAPL');
            """
        )
        for i in range(250):
            conn.execute("INSERT INTO companies VALUES (?)", (f"S{i}",))
        for day in ("2026-05-15", "2026-05-16", "2026-05-18"):
            for i in range(250):
                conn.execute(
                    "INSERT INTO daily_bars VALUES (?, ?)",
                    (f"S{i}", day),
                )
        with patch("large_cap.db_session_date.ny_today_ymd", return_value="2026-05-19"):
            self.assertEqual(get_latest_reliable_completed_date(conn), "2026-05-18")
        conn.close()

    def test_resolve_bumps_after_same_day_refresh(self) -> None:
        conn = sqlite3.connect(":memory:")
        conn.executescript(
            """
            CREATE TABLE companies (symbol TEXT);
            CREATE TABLE daily_bars (symbol TEXT, date TEXT);
            """
        )
        for i in range(250):
            conn.execute("INSERT INTO companies VALUES (?)", (f"S{i}",))
            conn.execute("INSERT INTO daily_bars VALUES (?, ?)", (f"S{i}", "2026-05-18"))

        with patch("large_cap.db_session_date.ny_today_ymd", return_value="2026-05-18"):
            self.assertEqual(resolve_analysis_date_ymd(conn, None), "2026-05-19")
        conn.close()

    def test_assert_db_stale(self) -> None:
        conn = sqlite3.connect(":memory:")
        conn.executescript(
            """
            CREATE TABLE companies (symbol TEXT);
            CREATE TABLE daily_bars (symbol TEXT, date TEXT);
            """
        )
        for i in range(250):
            conn.execute("INSERT INTO companies VALUES (?)", (f"S{i}",))
            conn.execute("INSERT INTO daily_bars VALUES (?, ?)", (f"S{i}", "2026-05-17"))

        with patch("large_cap.db_session_date.ny_today_ymd", return_value="2026-05-19"):
            with self.assertRaisesRegex(ValueError, "stale"):
                assert_db_covers_latest(conn, "2026-05-18")
        conn.close()


if __name__ == "__main__":
    unittest.main()
