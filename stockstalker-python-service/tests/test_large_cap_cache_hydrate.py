"""Cache hydrate — display-only reads without Claude on miss."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from large_cap.cached_analysis import try_hydrate_cached_analysis
from large_cap.digest_hash import compute_digest_hash


class TestTryHydrateCachedAnalysis(unittest.TestCase):
    PROFILE = "550e8400-e29b-41d4-a716-446655440000"

    @patch("large_cap.cached_analysis.get_cached_analysis")
    @patch("large_cap.cached_analysis.build_large_cap_digest")
    @patch("large_cap.cached_analysis.is_supabase_cache_configured", return_value=True)
    def test_returns_row_on_hash_match(
        self,
        _cfg: object,
        mock_digest: object,
        mock_get: object,
    ) -> None:
        digest = {
            "identity": {"ticker": "AAPL", "analysis_date": "2026-05-19", "data_mode": "historical"},
        }
        mock_digest.return_value = digest
        h = compute_digest_hash(digest)
        mock_get.return_value = {
            "digest_hash": h,
            "verdict_json": {"ticker": "AAPL", "verdict": "No Trade", "scenarios": []},
            "analyzed_at": "2026-05-19T12:00:00+00:00",
        }

        hit = try_hydrate_cached_analysis(self.PROFILE, "AAPL", "historical")
        assert hit is not None
        self.assertTrue(hit["cache_hit"])
        self.assertEqual(hit["verdict"]["verdict"], "No Trade")

    @patch("large_cap.cached_analysis.get_cached_analysis")
    @patch("large_cap.cached_analysis.build_large_cap_digest")
    @patch("large_cap.cached_analysis.is_supabase_cache_configured", return_value=True)
    def test_returns_none_on_miss_without_claude(
        self,
        _cfg: object,
        mock_digest: object,
        mock_get: object,
    ) -> None:
        digest = {
            "identity": {"ticker": "MSFT", "analysis_date": "2026-05-19", "data_mode": "historical"},
        }
        mock_digest.return_value = digest
        mock_get.return_value = None

        with patch("large_cap.cached_analysis.synthesize_large_cap_verdict") as mock_claude:
            hit = try_hydrate_cached_analysis(self.PROFILE, "MSFT", "historical")
            self.assertIsNone(hit)
            mock_claude.assert_not_called()


if __name__ == "__main__":
    unittest.main()
