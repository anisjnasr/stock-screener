"""Stage 6 verification — digest hash, verdict schema, cache gate (mocked)."""

from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from large_cap.claude_synthesis import parse_verdict_json, strip_markdown_code_fences
from large_cap.verdict_schema_samples import sample_no_trade, sample_trade
from large_cap.digest_hash import compute_digest_hash
from large_cap.cached_analysis import run_large_cap_analysis_cached


class TestDigestHash(unittest.TestCase):
    def test_stable_across_key_order(self) -> None:
        a = {"z": 1, "a": {"y": 2, "x": 3}}
        b = {"a": {"x": 3, "y": 2}, "z": 1}
        self.assertEqual(compute_digest_hash(a), compute_digest_hash(b))

    def test_changes_when_content_changes(self) -> None:
        d1 = {"identity": {"ticker": "AAPL", "analysis_date": "2026-05-18"}}
        d2 = {"identity": {"ticker": "AAPL", "analysis_date": "2026-05-19"}}
        self.assertNotEqual(compute_digest_hash(d1), compute_digest_hash(d2))


class TestVerdictSchema(unittest.TestCase):
    def test_no_trade(self) -> None:
        out = parse_verdict_json(json.dumps(sample_no_trade()))
        self.assertEqual(out["verdict"], "No Trade")
        self.assertEqual(out["scenarios"], [])

    def test_trade_three_scenarios(self) -> None:
        out = parse_verdict_json(json.dumps(sample_trade()))
        self.assertEqual(len(out["scenarios"]), 3)

    def test_structured_sections(self) -> None:
        out = parse_verdict_json(json.dumps(sample_trade()))
        self.assertIn("big_picture", out)
        self.assertIsInstance(out["recent_action"], list)
        self.assertGreaterEqual(len(out["key_levels"]), 4)

    def test_strips_code_fence(self) -> None:
        inner = json.dumps(sample_no_trade())
        fenced = "```json\n" + inner + "\n```"
        self.assertEqual(strip_markdown_code_fences(fenced), inner)


class TestCacheGate(unittest.TestCase):
    PROFILE = "550e8400-e29b-41d4-a716-446655440000"

    @patch("large_cap.cached_analysis.upsert_cached_analysis")
    @patch("large_cap.cached_analysis.synthesize_large_cap_verdict")
    @patch("large_cap.cached_analysis.get_cached_analysis")
    @patch("large_cap.cached_analysis.build_large_cap_digest")
    @patch("large_cap.cached_analysis.is_supabase_cache_configured", return_value=True)
    def test_cache_hit_skips_claude(
        self,
        _cfg: object,
        mock_digest: object,
        mock_get: object,
        mock_synth: object,
        mock_upsert: object,
    ) -> None:
        digest = {
            "identity": {"ticker": "AAPL", "analysis_date": "2026-05-18", "data_mode": "historical"},
            "historical_analogues": {"match_count": 0},
        }
        mock_digest.return_value = digest
        h = compute_digest_hash(digest)
        mock_get.return_value = {
            "digest_hash": h,
            "verdict_json": {"ticker": "AAPL", "verdict": "No Trade", "scenarios": []},
            "analyzed_at": "2026-05-18T12:00:00+00:00",
            "data_mode": "historical",
        }

        result = run_large_cap_analysis_cached(self.PROFILE, "AAPL", "historical")

        self.assertTrue(result["cache_hit"])
        self.assertFalse(result["claude_call_made"])
        mock_synth.assert_not_called()
        mock_upsert.assert_not_called()

    @patch("large_cap.cached_analysis.upsert_cached_analysis")
    @patch("large_cap.cached_analysis.synthesize_large_cap_verdict")
    @patch("large_cap.cached_analysis.get_cached_analysis")
    @patch("large_cap.cached_analysis.build_large_cap_digest")
    @patch("large_cap.cached_analysis.is_supabase_cache_configured", return_value=True)
    def test_cache_miss_calls_claude(
        self,
        _cfg: object,
        mock_digest: object,
        mock_get: object,
        mock_synth: object,
        mock_upsert: object,
    ) -> None:
        digest = {
            "identity": {"ticker": "AAPL", "analysis_date": "2026-05-18", "data_mode": "historical"},
        }
        mock_digest.return_value = digest
        mock_get.return_value = None
        verdict = {
            "ticker": "AAPL",
            "verdict": "No Trade",
            "verdict_reason": "x",
            "bias": "Neutral",
            "narrative": "n",
            "scenarios": [],
        }
        mock_synth.return_value = verdict
        mock_upsert.return_value = "2026-05-18T14:00:00+00:00"

        result = run_large_cap_analysis_cached(self.PROFILE, "AAPL", "historical")

        self.assertFalse(result["cache_hit"])
        self.assertTrue(result["claude_call_made"])
        mock_synth.assert_called_once()
        mock_upsert.assert_called_once()

    def test_invalid_profile_id(self) -> None:
        with patch("large_cap.cached_analysis.is_supabase_cache_configured", return_value=True):
            with self.assertRaises(ValueError):
                run_large_cap_analysis_cached("not-a-uuid", "AAPL", "historical")


if __name__ == "__main__":
    unittest.main()
