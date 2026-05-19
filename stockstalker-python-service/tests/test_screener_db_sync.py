"""Tests for peer screener.db sync helpers."""

from __future__ import annotations

import sqlite3
import tempfile
import unittest
from pathlib import Path

from large_cap.screener_db_sync import _prune_sync_artifacts, _validate_sqlite_db


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

    def test_prune_sync_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            data = Path(tmp)
            staged = data / "screener.db.staged.20260101"
            staged.write_bytes(b"x")
            backups = data / "backups"
            backups.mkdir()
            (backups / "screener.db.before-sync.old").write_bytes(b"a")
            (backups / "screener.db.before-sync.new").write_bytes(b"b")
            _prune_sync_artifacts(data)
            self.assertFalse(staged.exists())
            remaining = list(backups.glob("screener.db.before-sync.*"))
            self.assertEqual(len(remaining), 0)


if __name__ == "__main__":
    unittest.main()
