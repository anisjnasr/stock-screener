"""Stage 9 verification — outcome scorer (daily OHLC only)."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from large_cap.archive_scoring import iter_score_pending_archives
from large_cap.outcome_scorer import (
    determine_outcome,
    score_scenario_against_bar,
    score_trade_result_json,
)


def _scenario(rank: int, trigger: float, target: float, invalidation: float) -> dict:
    return {
        "rank": rank,
        "key_levels": {"trigger": trigger, "target": target, "invalidation": invalidation},
    }


class TestScenarioScoring(unittest.TestCase):
    def test_confirmed_occurred(self) -> None:
        bar = {"open": 100, "high": 110, "low": 99, "close": 108}
        s = _scenario(1, trigger=100, target=108, invalidation=95)
        out = score_scenario_against_bar(s, bar)
        self.assertEqual(out["classification"], "confirmed_occurred")

    def test_confirmed_did_not_occur(self) -> None:
        bar = {"open": 100, "high": 101, "low": 94, "close": 95}
        s = _scenario(2, trigger=100, target=110, invalidation=95)
        out = score_scenario_against_bar(s, bar)
        self.assertEqual(out["classification"], "confirmed_did_not_occur")

    def test_unresolvable_ambiguous(self) -> None:
        bar = {"open": 100, "high": 112, "low": 94, "close": 105}
        s = _scenario(1, trigger=100, target=110, invalidation=95)
        out = score_scenario_against_bar(s, bar)
        self.assertEqual(out["classification"], "unresolvable")

    def test_none_outcome(self) -> None:
        bar = {"open": 100, "high": 101, "low": 99, "close": 100.5}
        result = score_trade_result_json(
            {
                "verdict": "Trade",
                "scenarios": [
                    _scenario(1, 105, 110, 95),
                    _scenario(2, 90, 85, 102),
                    _scenario(3, 120, 125, 115),
                ],
            },
            bar,
        )
        self.assertEqual(result["outcome"], "None")

    def test_ambiguous_outcome(self) -> None:
        bar = {"open": 100, "high": 112, "low": 94, "close": 105}
        result = score_trade_result_json(
            {
                "verdict": "Trade",
                "scenarios": [
                    _scenario(1, 100, 110, 95),
                    _scenario(2, 200, 210, 190),
                    _scenario(3, 300, 310, 290),
                ],
            },
            bar,
        )
        self.assertEqual(result["outcome"], "Ambiguous")

    def test_scenario_1_wins_tiebreak(self) -> None:
        bar = {"open": 100, "high": 115, "low": 98, "close": 112}
        per = [
            score_scenario_against_bar(_scenario(1, 100, 110, 90), bar),
            score_scenario_against_bar(_scenario(2, 100, 108, 92), bar),
            _scenario(3, 300, 310, 290),
        ]
        per[2] = score_scenario_against_bar(per[2], bar)
        self.assertEqual(determine_outcome(per), "Scenario 1")


class TestArchiveScoringRun(unittest.TestCase):
    PROFILE = "550e8400-e29b-41d4-a716-446655440000"

    @patch("large_cap.archive_scoring.mark_archive_scored")
    @patch("large_cap.archive_scoring.score_archive_row_if_ready")
    @patch("large_cap.archive_scoring.list_pending_archive_rows")
    def test_yields_scored_events(
        self,
        mock_list: object,
        mock_score: object,
        mock_mark: object,
    ) -> None:
        mock_list.return_value = [  # type: ignore[attr-defined]
            {
                "ticker": "AAPL",
                "trading_date": "2026-05-15",
                "result_json": {"verdict": "Trade", "scenarios": [{}]},
            }
        ]
        mock_score.return_value = {  # type: ignore[attr-defined]
            "outcome": "Scenario 1",
            "scoring_json": {"scenarios": []},
            "outcome_session": "2026-05-18",
        }

        events = list(iter_score_pending_archives(self.PROFILE, analysis_date="2026-05-19"))
        types = [e["type"] for e in events]
        self.assertIn("archive_scored", types)
        self.assertEqual(events[-1]["type"], "archive_scoring_complete")
        self.assertEqual(events[-1]["scored_count"], 1)
        mock_mark.assert_called_once()  # type: ignore[attr-defined]


if __name__ == "__main__":
    unittest.main()
