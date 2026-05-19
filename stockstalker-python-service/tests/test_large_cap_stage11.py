"""Stage 11 verification — archive list API and helpers."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from main import app

PROFILE = "550e8400-e29b-41d4-a716-446655440000"
KEY = "test-internal-key"

SAMPLE_ROWS = [
    {
        "ticker": "AAPL",
        "trading_date": "2026-05-17",
        "result_json": {
            "verdict": "Trade",
            "scenarios": [
                {"rank": 1, "confidence": "High", "title": "Breakout"},
                {"rank": 2, "confidence": "Medium", "title": "Fail"},
                {"rank": 3, "confidence": "Low", "title": "Base"},
            ],
        },
        "outcome": "Scenario 1",
        "scoring_json": {"scenarios": [{"rank": 1, "trigger_reached": True}]},
        "scored": True,
        "outcome_scored_at": "2026-05-18T14:00:00+00:00",
        "logged_at": "2026-05-17T13:00:00+00:00",
        "updated_at": "2026-05-18T14:00:00+00:00",
    }
]


class TestArchiveListRoute(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)

    @patch.dict("os.environ", {"INTERNAL_API_KEY": KEY}, clear=False)
    @patch("main.list_archive_rows", return_value=SAMPLE_ROWS)
    def test_list_returns_rows(self, mock_list: object) -> None:
        res = self.client.post(
            "/large-cap/archive/list",
            headers={"Authorization": f"Bearer {KEY}"},
            json={"profile_id": PROFILE},
        )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertTrue(body["ok"])
        self.assertEqual(len(body["rows"]), 1)
        self.assertEqual(body["rows"][0]["ticker"], "AAPL")
        mock_list.assert_called_once()  # type: ignore[attr-defined]

    @patch.dict("os.environ", {"INTERNAL_API_KEY": KEY}, clear=False)
    @patch("main.list_archive_rows", return_value=[])
    def test_list_passes_filters(self, mock_list: object) -> None:
        res = self.client.post(
            "/large-cap/archive/list",
            headers={"Authorization": f"Bearer {KEY}"},
            json={
                "profile_id": PROFILE,
                "ticker": "msft",
                "date_from": "2026-05-01",
                "date_to": "2026-05-31",
                "outcome": "Pending",
            },
        )
        self.assertEqual(res.status_code, 200)
        mock_list.assert_called_once_with(  # type: ignore[attr-defined]
            PROFILE,
            ticker="MSFT",
            date_from="2026-05-01",
            date_to="2026-05-31",
            outcome="Pending",
            limit=500,
        )

    @patch.dict("os.environ", {"INTERNAL_API_KEY": KEY}, clear=False)
    def test_list_requires_auth(self) -> None:
        res = self.client.post(
            "/large-cap/archive/list",
            json={"profile_id": PROFILE},
        )
        self.assertEqual(res.status_code, 401)


class TestListArchiveRows(unittest.TestCase):
    @patch("large_cap.supabase_archive.httpx.Client")
    @patch("large_cap.supabase_archive.supabase_rest_config", return_value=("https://x.supabase.co", "key"))
    def test_builds_query_with_pending_filter(self, _cfg: object, mock_client_cls: object) -> None:
        mock_res = unittest.mock.Mock()
        mock_res.status_code = 200
        mock_res.json.return_value = []
        mock_client = unittest.mock.Mock()
        mock_client.__enter__ = unittest.mock.Mock(return_value=mock_client)
        mock_client.__exit__ = unittest.mock.Mock(return_value=False)
        mock_client.get.return_value = mock_res
        mock_client_cls.return_value = mock_client  # type: ignore[attr-defined]

        from large_cap.supabase_archive import list_archive_rows

        list_archive_rows(PROFILE, outcome="Pending", limit=100)

        url = mock_client.get.call_args[0][0]
        self.assertIn("scored=eq.false", url)
        self.assertIn("limit=100", url)


if __name__ == "__main__":
    unittest.main()
