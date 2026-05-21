"""Tests for server-side verdict finalization (comps merge + validation)."""

from __future__ import annotations

import json
import unittest

from large_cap.claude_synthesis import LargeCapVerdictJson
from large_cap.verdict_finalize import attach_comps_to_verdict, finalize_large_cap_verdict
from large_cap.verdict_schema_samples import sample_no_trade, sample_trade


def _digest_with_analogues() -> dict:
    return {
        "identity": {"ticker": "MU", "analysis_date": "2026-05-20", "data_mode": "historical_premarket"},
        "premarket": {"last_price": 100.5, "gap_pct_vs_prior_close": 2.1},
        "historical_analogues": {
            "match_count": 22,
            "low_sample": False,
            "summary_tendencies": {
                "follow_through_count": 12,
                "reversed_count": 7,
                "flat_or_chop_count": 3,
                "avg_next_day_true_range_pct_of_open": 2.05,
            },
            "examples": [
                {
                    "analogue_session_date": "2026-04-01",
                    "overnight_gap_pct_into_next_session": 1.4,
                    "next_session": {
                        "follow_through_label": "follow_through",
                        "close_vs_open_pct": 1.8,
                    },
                }
            ],
        },
    }


class TestVerdictFinalize(unittest.TestCase):
    def test_attach_comps_validates_full_contract(self) -> None:
        out = attach_comps_to_verdict(sample_trade(), _digest_with_analogues(), data_mode="historical_premarket")
        LargeCapVerdictJson.model_validate(out)
        self.assertIn("comps", out)
        self.assertEqual(out["comps"]["total"], 22)
        self.assertNotIn("historical_analogues", out)

    def test_strips_premarket_in_historical_mode(self) -> None:
        raw = sample_trade()
        digest = _digest_with_analogues()
        digest["identity"]["data_mode"] = "historical"
        digest["premarket"] = None
        out = attach_comps_to_verdict(raw, digest, data_mode="historical")
        self.assertNotIn("pre_market", out)

    def test_remerge_from_cache_strips_old_comps(self) -> None:
        merged = attach_comps_to_verdict(sample_trade(), _digest_with_analogues(), data_mode="historical_premarket")
        merged["comps"]["total"] = 999
        again = attach_comps_to_verdict(merged, _digest_with_analogues(), data_mode="historical_premarket")
        self.assertEqual(again["comps"]["total"], 22)

    def test_legacy_verdict_uses_narrative_normalizer(self) -> None:
        legacy = {
            "ticker": "AAPL",
            "verdict": "No Trade",
            "verdict_reason": "Quiet.",
            "bias": "Neutral",
            "narrative": "Rangebound on all windows.",
            "scenarios": [],
        }
        digest = {"identity": {"data_mode": "historical"}, "historical_analogues": {"match_count": 0}}
        out = finalize_large_cap_verdict(legacy, digest, data_mode="historical")
        self.assertIn("narrative_sections", out)

    def test_sample_no_trade_with_comps(self) -> None:
        out = attach_comps_to_verdict(sample_no_trade(), _digest_with_analogues(), data_mode="historical")
        self.assertEqual(out["verdict"], "No Trade")
        self.assertIn("comps", out)
        print(json.dumps(out, indent=2)[:1200])


if __name__ == "__main__":
    unittest.main()
