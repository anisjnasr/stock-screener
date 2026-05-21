"""Tests for blueprint §9 Claude verdict schema (v2 structured sections)."""

from __future__ import annotations

import json
import unittest

from large_cap.claude_synthesis import ClaudeLargeCapVerdictJson, parse_verdict_json
from large_cap.verdict_schema_samples import sample_no_trade, sample_trade


class TestClaudeVerdictSchemaV2(unittest.TestCase):
    def test_no_trade_parses(self) -> None:
        out = parse_verdict_json(json.dumps(sample_no_trade()))
        self.assertEqual(out["verdict"], "No Trade")
        self.assertIsInstance(out["recent_action"], list)
        self.assertNotIn("comps", out)

    def test_trade_parses(self) -> None:
        out = parse_verdict_json(json.dumps(sample_trade()))
        self.assertEqual(out["verdict"], "Trade")
        self.assertEqual(len(out["scenarios"]), 3)
        self.assertEqual({s["label"] for s in out["scenarios"]}, {"A", "B", "C"})
        self.assertGreaterEqual(len(out["key_levels"]), 4)

    def test_rejects_comps_from_claude(self) -> None:
        raw = sample_trade()
        raw["comps"] = {
            "total": 1,
            "follow_through": 1,
            "reversal": 0,
            "flat": 0,
            "avg_next_day_range_pct": 1.0,
            "avg_follow_through_pct": 1.0,
            "avg_reversal_pct": 0.0,
            "recent_examples": [],
            "low_sample": True,
        }
        with self.assertRaises(ValueError):
            parse_verdict_json(json.dumps(raw))

    def test_rejects_legacy_narrative_sections(self) -> None:
        raw = sample_no_trade()
        raw["narrative_sections"] = {"big_picture": "x"}
        with self.assertRaises(Exception):
            ClaudeLargeCapVerdictJson.model_validate(raw)


if __name__ == "__main__":
    unittest.main()
