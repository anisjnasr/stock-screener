"""Tests for narrative section normalization."""

from __future__ import annotations

import json
import unittest

from large_cap.claude_synthesis import parse_verdict_json
from large_cap.narrative_structure import ensure_structured_narrative, split_narrative_into_sections


class TestNarrativeStructure(unittest.TestCase):
    def test_split_legacy_narrative(self) -> None:
        sections = split_narrative_into_sections(
            "Stock sits in a multi-month base. Yesterday expanded range vs ATR. "
            "Three historical analogues followed through. Pre-market gapped up on volume."
        )
        self.assertTrue(sections["big_picture"])
        self.assertTrue(sections["recent_action"])
        self.assertTrue(sections["historical_analogues"])
        self.assertTrue(sections["pre_market"])

    def test_ensure_structured_from_legacy(self) -> None:
        digest = {
            "trend_and_momentum": {"trend_label": "uptrend"},
            "multi_timescale_ranges": {
                "short_sessions": 4,
                "short": {"high": 110.0, "low": 100.0},
            },
            "historical_analogues": {
                "match_count": 3,
                "low_sample": False,
                "summary_tendencies": {
                    "follow_through_count": 2,
                    "reversed_count": 1,
                    "flat_or_chop_count": 0,
                },
            },
            "key_levels": {"prior_day_high": 108.0, "prior_day_low": 99.0},
        }
        verdict = {
            "ticker": "AAPL",
            "verdict": "Trade",
            "verdict_reason": "Setup.",
            "bias": "Bullish",
            "narrative": (
                "AAPL is in a tight base on the longer window. "
                "Yesterday showed range expansion. "
                "Analogues lean follow-through. "
                "Pre-market gapped above prior day high."
            ),
            "scenarios": [
                {
                    "rank": 1,
                    "confidence": "High",
                    "title": "Breakout",
                    "description": "d",
                    "key_levels": {"trigger": 108.0, "target": 112.0, "invalidation": 105.0},
                    "expected_move_pct": 2.0,
                    "direction": "Long",
                },
                {
                    "rank": 2,
                    "confidence": "Medium",
                    "title": "Fail",
                    "description": "d",
                    "key_levels": {"trigger": 105.0, "target": 100.0, "invalidation": 109.0},
                    "expected_move_pct": 2.0,
                    "direction": "Short",
                },
                {
                    "rank": 3,
                    "confidence": "Low",
                    "title": "Chop",
                    "description": "d",
                    "key_levels": {"trigger": 107.0, "target": 108.0, "invalidation": 104.0},
                    "expected_move_pct": 1.0,
                    "direction": "Either",
                },
            ],
        }
        out = ensure_structured_narrative(verdict, digest, data_mode="historical_premarket")
        sections = out["narrative_sections"]
        self.assertTrue(sections["big_picture"])
        self.assertTrue(sections["recent_action"])
        self.assertTrue(sections["historical_analogues"])
        self.assertTrue(sections["pre_market"])
        self.assertGreaterEqual(len(out["decision_levels"]), 1)
        sources = {row["source"] for row in out["decision_levels"]}
        self.assertNotIn("Primary scenario", sources)

    def test_decision_level_zone_schema(self) -> None:
        raw = {
            "ticker": "NVDA",
            "verdict": "Trade",
            "verdict_reason": "Range setup.",
            "bias": "Neutral",
            "narrative_sections": {
                "big_picture": "Consolidating.",
                "recent_action": "Tight.",
                "historical_analogues": "Few matches.",
                "pre_market": "Quiet PM.",
            },
            "decision_levels": [
                {
                    "role": "Range",
                    "source": "4-day consolidation area",
                    "zone_low": 410.0,
                    "zone_high": 425.0,
                }
            ],
            "scenarios": [
                {
                    "rank": 1,
                    "confidence": "Medium",
                    "title": "Breakout",
                    "description": "d",
                    "key_levels": {"trigger": 425.0, "target": 430.0, "invalidation": 410.0},
                    "expected_move_pct": 1.0,
                    "direction": "Long",
                },
                {
                    "rank": 2,
                    "confidence": "Low",
                    "title": "Fail",
                    "description": "d",
                    "key_levels": {"trigger": 410.0, "target": 405.0, "invalidation": 420.0},
                    "expected_move_pct": 1.0,
                    "direction": "Short",
                },
                {
                    "rank": 3,
                    "confidence": "Low",
                    "title": "Chop",
                    "description": "d",
                    "key_levels": {"trigger": 418.0, "target": 422.0, "invalidation": 412.0},
                    "expected_move_pct": 1.0,
                    "direction": "Either",
                },
            ],
        }
        out = parse_verdict_json(json.dumps(raw))
        zone = out["decision_levels"][0]
        self.assertEqual(zone["role"], "Range")
        self.assertEqual(zone["source"], "4-day consolidation area")
        self.assertEqual(zone["zone_low"], 410.0)
        self.assertEqual(zone["zone_high"], 425.0)


if __name__ == "__main__":
    unittest.main()
