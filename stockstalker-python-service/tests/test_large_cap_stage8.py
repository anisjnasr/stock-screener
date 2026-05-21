"""Stage 8 verification — Trade verdict archive writes."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from large_cap.cached_analysis import run_large_cap_analysis_cached
from large_cap.supabase_archive import is_trade_verdict, maybe_write_trade_archive


class TestTradeVerdictDetection(unittest.TestCase):
    def test_trade(self) -> None:
        self.assertTrue(is_trade_verdict({"verdict": "Trade"}))

    def test_no_trade(self) -> None:
        self.assertFalse(is_trade_verdict({"verdict": "No Trade"}))


class TestArchiveWriteGate(unittest.TestCase):
    PROFILE = "550e8400-e29b-41d4-a716-446655440000"

    @patch("large_cap.cached_analysis.maybe_write_trade_archive", return_value=False)
    @patch("large_cap.cached_analysis.upsert_cached_analysis")
    @patch("large_cap.cached_analysis.synthesize_large_cap_verdict")
    @patch("large_cap.cached_analysis.get_cached_analysis")
    @patch("large_cap.cached_analysis.build_large_cap_digest")
    @patch("large_cap.cached_analysis.is_supabase_cache_configured", return_value=True)
    def test_no_trade_skips_archive(
        self,
        _cfg: object,
        mock_digest: object,
        mock_get: object,
        mock_synth: object,
        mock_upsert: object,
        mock_archive: object,
    ) -> None:
        digest = {
            "identity": {"ticker": "AAPL", "analysis_date": "2026-05-18", "data_mode": "historical"},
        }
        mock_digest.return_value = digest
        mock_get.return_value = None
        mock_synth.return_value = {
            "ticker": "AAPL",
            "verdict": "No Trade",
            "verdict_reason": "Rangebound.",
            "bias": "Neutral",
            "narrative": "Quiet.",
            "scenarios": [],
        }
        mock_upsert.return_value = "2026-05-18T14:00:00+00:00"

        result = run_large_cap_analysis_cached(self.PROFILE, "AAPL", "historical")

        mock_archive.assert_called_once()
        self.assertFalse(result["archive_written"])

    @patch("large_cap.cached_analysis.maybe_write_trade_archive", return_value=True)
    @patch("large_cap.cached_analysis.upsert_cached_analysis")
    @patch("large_cap.cached_analysis.synthesize_large_cap_verdict")
    @patch("large_cap.cached_analysis.get_cached_analysis")
    @patch("large_cap.cached_analysis.build_large_cap_digest")
    @patch("large_cap.cached_analysis.is_supabase_cache_configured", return_value=True)
    def test_trade_writes_archive(
        self,
        _cfg: object,
        mock_digest: object,
        mock_get: object,
        mock_synth: object,
        mock_upsert: object,
        mock_archive: object,
    ) -> None:
        digest = {
            "identity": {"ticker": "MSFT", "analysis_date": "2026-05-18", "data_mode": "historical"},
        }
        mock_digest.return_value = digest
        mock_get.return_value = None
        verdict = {
            "ticker": "MSFT",
            "verdict": "Trade",
            "verdict_reason": "Breakout.",
            "bias": "Bullish",
            "narrative": "Gap out of base.",
            "scenarios": [{"rank": 1}, {"rank": 2}, {"rank": 3}],
        }
        mock_synth.return_value = verdict
        mock_upsert.return_value = "2026-05-18T14:00:00+00:00"

        result = run_large_cap_analysis_cached(self.PROFILE, "MSFT", "historical")

        mock_archive.assert_called_once()
        _pid, sym, trading_date, archived = mock_archive.call_args[0]
        self.assertEqual(sym, "MSFT")
        self.assertEqual(archived["verdict"], "Trade")
        self.assertTrue(result["archive_written"])

    @patch("large_cap.supabase_archive.upsert_trade_archive")
    def test_maybe_write_no_trade(self, mock_upsert: object) -> None:
        self.assertFalse(
            maybe_write_trade_archive(
                self.PROFILE,
                "AAPL",
                "2026-05-18",
                {"verdict": "No Trade", "scenarios": []},
            )
        )
        mock_upsert.assert_not_called()


if __name__ == "__main__":
    unittest.main()
