"""Tests for decision level normalization."""

from __future__ import annotations

import unittest

from large_cap.decision_levels import normalize_decision_level_item


class TestDecisionLevels(unittest.TestCase):
    def test_role_source_price(self) -> None:
        rows = normalize_decision_level_item(
            {"role": "Trigger", "source": "Prior day high", "price": 420.0}
        )
        self.assertEqual(rows, [{"role": "Trigger", "source": "Prior day high", "price": 420.0}])

    def test_legacy_label_split(self) -> None:
        rows = normalize_decision_level_item(
            {"label": "Prior day high — breakout trigger if cleared", "price": 420.0}
        )
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["role"], "Trigger")
        self.assertEqual(rows[0]["source"], "Prior day high")

    def test_zone_band(self) -> None:
        rows = normalize_decision_level_item(
            {
                "role": "Range",
                "source": "Top of consolidation area",
                "zone_low": 410.0,
                "zone_high": 425.0,
            }
        )
        self.assertEqual(rows[0]["zone_low"], 410.0)
        self.assertEqual(rows[0]["zone_high"], 425.0)


if __name__ == "__main__":
    unittest.main()
