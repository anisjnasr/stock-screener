"""HTTP smoke tests for POST /large-cap/run (mocked analyze)."""

from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from main import app

PROFILE = "550e8400-e29b-41d4-a716-446655440000"
KEY = "test-internal-key"


class TestLargeCapRunRoute(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)

    @patch.dict("os.environ", {"INTERNAL_API_KEY": KEY}, clear=False)
    @patch("large_cap.archive_scoring.list_pending_archive_rows", return_value=[])
    @patch("large_cap.cached_analysis.run_large_cap_analysis_cached")
    def test_run_streams_ndjson(
        self,
        mock_analyze: object,
        _mock_pending: object,
    ) -> None:
        def side_effect(_pid: str, ticker: str, *_a: object, **_k: object) -> dict:
            return {
                "cache_hit": True,
                "claude_call_made": False,
                "digest_hash": "h1",
                "trading_date": "2026-05-18",
                "data_mode": "historical",
                "analyzed_at": "2026-05-18T12:00:00+00:00",
                "digest": {"identity": {"ticker": ticker}},
                "verdict": {"ticker": ticker, "verdict": "No Trade", "scenarios": []},
                "archive_written": False,
            }

        mock_analyze.side_effect = side_effect  # type: ignore[attr-defined]

        res = self.client.post(
            "/large-cap/run",
            headers={"Authorization": f"Bearer {KEY}"},
            json={
                "profile_id": PROFILE,
                "tickers": ["AAPL", "MSFT"],
                "data_mode": "historical",
                "concurrency": 2,
            },
        )
        self.assertEqual(res.status_code, 200)
        self.assertIn("application/x-ndjson", res.headers.get("content-type", ""))

        events = [json.loads(line) for line in res.text.strip().split("\n") if line.strip()]
        types = [e["type"] for e in events]
        self.assertIn("archive_scoring_complete", types)
        self.assertIn("run_started", types)
        self.assertEqual(types[-1], "run_complete")
        self.assertEqual(events[-1]["ok_count"], 2)
        row_tickers = sorted(e["ticker"] for e in events if e["type"] == "row_result")
        self.assertEqual(row_tickers, ["AAPL", "MSFT"])

    @patch.dict("os.environ", {"INTERNAL_API_KEY": KEY}, clear=False)
    def test_run_requires_auth(self) -> None:
        res = self.client.post(
            "/large-cap/run",
            json={"profile_id": PROFILE, "tickers": ["AAPL"]},
        )
        self.assertEqual(res.status_code, 401)


if __name__ == "__main__":
    unittest.main()
