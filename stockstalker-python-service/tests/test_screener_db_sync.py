"""Tests for peer screener.db sync helpers."""

from __future__ import annotations

import sqlite3
import tempfile
import unittest
from pathlib import Path

from large_cap.screener_db_sync import _validate_sqlite_db


class TestScreenerDbSync(unittest.TestCase):
    def test_validate_sqlite_db(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "test.db"
            conn = sqlite3.connect(path)
            conn.executescript(
                """
                CREATE TABLE companies (symbol TEXT);
                CREATE TABLE daily_bars (symbol TEXT, date TEXT);
                INSERT INTO companies VALUES ('AAPL');
                INSERT INTO daily_bars VALUES ('AAPL', '2026-05-18');
                """
            )
            conn.close()
            stats = _validate_sqlite_db(path)
            self.assertEqual(stats["latest_daily_bars"], "2026-05-18")
            self.assertEqual(stats["companies"], "1")


if __name__ == "__main__":
    unittest.main()
