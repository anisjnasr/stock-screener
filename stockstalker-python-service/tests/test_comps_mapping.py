"""Tests for digest historical_analogues → verdict.comps mapping."""

from __future__ import annotations

import unittest

from large_cap.comps_mapping import map_historical_analogues_to_comps


class TestCompsMapping(unittest.TestCase):
    def test_maps_counts_and_examples(self) -> None:
        block = {
            "match_count": 24,
            "low_sample": False,
            "summary_tendencies": {
                "follow_through_count": 14,
                "reversed_count": 6,
                "flat_or_chop_count": 4,
                "avg_next_day_true_range_pct_of_open": 2.35,
            },
            "examples": [
                {
                    "analogue_session_date": "2026-03-10",
                    "overnight_gap_pct_into_next_session": 1.2,
                    "next_session": {
                        "follow_through_label": "follow_through",
                        "close_vs_open_pct": 2.1,
                    },
                },
                {
                    "analogue_session_date": "2026-02-04",
                    "overnight_gap_pct_into_next_session": -0.8,
                    "next_session": {
                        "follow_through_label": "reversed",
                        "close_vs_open_pct": -1.5,
                    },
                },
            ],
        }
        comps = map_historical_analogues_to_comps(block)
        self.assertEqual(comps["total"], 24)
        self.assertEqual(comps["follow_through"], 14)
        self.assertEqual(comps["reversal"], 6)
        self.assertEqual(comps["flat"], 4)
        self.assertEqual(comps["avg_next_day_range_pct"], 2.35)
        self.assertEqual(len(comps["recent_examples"]), 2)
        self.assertEqual(comps["recent_examples"][0]["outcome"], "follow_through")
        self.assertEqual(comps["recent_examples"][1]["outcome"], "reversal")
        self.assertFalse(comps["low_sample"])

    def test_low_sample_when_total_below_20(self) -> None:
        block = {
            "match_count": 8,
            "low_sample": False,
            "summary_tendencies": {
                "follow_through_count": 5,
                "reversed_count": 2,
                "flat_or_chop_count": 1,
                "avg_next_day_true_range_pct_of_open": 1.1,
            },
            "examples": [],
        }
        comps = map_historical_analogues_to_comps(block)
        self.assertTrue(comps["low_sample"])


if __name__ == "__main__":
    unittest.main()
