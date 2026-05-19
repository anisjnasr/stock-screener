"""Tests for digest level source catalog."""

from __future__ import annotations

import unittest

from large_cap.level_source_catalog import (
    collect_digest_level_catalog,
    enrich_level_source,
    match_price_to_digest_source,
)


class TestLevelSourceCatalog(unittest.TestCase):
    def test_match_prior_day_high(self) -> None:
        digest = {
            "key_levels": {"prior_day_high": 420.0, "prior_day_low": 415.0},
            "multi_timescale_ranges": {"short_sessions": 4, "short": {"high": 425.0, "low": 410.0}},
        }
        catalog = collect_digest_level_catalog(digest)
        self.assertEqual(match_price_to_digest_source(420.0, catalog), "Prior day high")
        self.assertEqual(match_price_to_digest_source(415.0, catalog), "Prior day low")

    def test_enrich_replaces_primary_scenario(self) -> None:
        digest = {"key_levels": {"prior_day_high": 420.0}}
        level = {"role": "Trigger", "source": "Primary scenario", "price": 420.0}
        out = enrich_level_source(level, digest)
        self.assertEqual(out["source"], "Prior day high")

    def test_enrich_keeps_explicit_source(self) -> None:
        digest = {"key_levels": {"prior_day_high": 420.0}}
        level = {"role": "Trigger", "source": "Top of consolidation area", "price": 420.0}
        out = enrich_level_source(level, digest)
        self.assertEqual(out["source"], "Top of consolidation area")


if __name__ == "__main__":
    unittest.main()
