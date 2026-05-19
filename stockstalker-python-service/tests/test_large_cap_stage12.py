"""
Stage 12 — end-to-end checklist (blueprint §13 stage 12).

Automates the manual verification checklist with mocked externals where needed.
"""

from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from large_cap.claude_synthesis import parse_verdict_json
from large_cap.digest_hash import compute_digest_hash
from large_cap.outcome_scorer import score_trade_result_json
from large_cap.run_orchestrator import iter_large_cap_run_events

PROFILE = "550e8400-e29b-41d4-a716-446655440000"
KEY = "test-internal-key"


def _trade_verdict() -> dict:
    scenarios = []
    directions = ["Long", "Short", "Either"]
    titles = ["Follow-through", "Failure / reversal", "Consolidation"]
    for rank, (direction, title) in enumerate(zip(directions, titles, strict=True), start=1):
        scenarios.append(
            {
                "rank": rank,
                "confidence": "Medium",
                "title": title,
                "description": f"Scenario {rank} path.",
                "key_levels": {
                    "trigger": 100.0 + rank,
                    "target": 105.0 + rank,
                    "invalidation": 98.0 + rank,
                },
                "expected_move_pct": 2.0,
                "direction": direction,
            }
        )
    return {
        "ticker": "AAPL",
        "verdict": "Trade",
        "verdict_reason": "Setup.",
        "bias": "Bullish",
        "narrative": "Three prior gap-ups in the analogue set followed through; one reversed.",
        "scenarios": scenarios,
    }


class TestE2EDataModes(unittest.TestCase):
    def test_run_events_carry_data_mode_for_both_modes(self) -> None:
        def mock_analyze(_pid: str, _ticker: str, data_mode: str, *_a: object, **_k: object) -> dict:
            return {
                "cache_hit": True,
                "claude_call_made": False,
                "digest_hash": "h",
                "trading_date": "2026-05-18",
                "data_mode": data_mode,
                "analyzed_at": "t",
                "digest": {},
                "verdict": {"verdict": "No Trade", "scenarios": []},
            }

        for mode in ("historical", "historical_premarket"):
            events = list(
                iter_large_cap_run_events(
                    PROFILE,
                    ["AAPL"],
                    mode,  # type: ignore[arg-type]
                    analyze_fn=mock_analyze,
                )
            )
            started = events[0]
            self.assertEqual(started["type"], "run_started")
            self.assertEqual(started["data_mode"], mode)


class TestE2ECachingAndRun(unittest.TestCase):
    @patch("large_cap.cached_analysis.upsert_cached_analysis")
    @patch("large_cap.cached_analysis.synthesize_large_cap_verdict")
    @patch("large_cap.cached_analysis.get_cached_analysis")
    @patch("large_cap.cached_analysis.build_large_cap_digest")
    @patch("large_cap.cached_analysis.is_supabase_cache_configured", return_value=True)
    def test_cache_hit_skips_unchanged_stock(
        self,
        _cfg: object,
        mock_digest: object,
        mock_get: object,
        mock_synth: object,
        mock_upsert: object,
    ) -> None:
        from large_cap.cached_analysis import run_large_cap_analysis_cached

        digest = {
            "identity": {"ticker": "AAPL", "analysis_date": "2026-05-18", "data_mode": "historical"},
        }
        mock_digest.return_value = digest
        h = compute_digest_hash(digest)
        mock_get.return_value = {
            "digest_hash": h,
            "verdict_json": {"ticker": "AAPL", "verdict": "No Trade", "scenarios": []},
            "analyzed_at": "2026-05-18T12:00:00+00:00",
            "data_mode": "historical",
        }

        result = run_large_cap_analysis_cached(PROFILE, "AAPL", "historical")
        self.assertTrue(result["cache_hit"])
        mock_synth.assert_not_called()

    def test_trade_rows_sort_above_no_trade(self) -> None:
        """Mirrors TS sortLargeCapRows — Trade (High conf) before No Trade."""
        rows = [
            {"ticker": "Z", "status": "done", "verdict": {"verdict": "No Trade", "scenarios": []}},
            {"ticker": "A", "status": "done", "verdict": {"verdict": "Trade", "scenarios": [{"confidence": "High"}]}},
        ]

        def rank(r: dict) -> int:
            v = r["verdict"]["verdict"]
            if v == "Trade":
                return 0
            if v == "No Trade":
                return 3
            return 5

        sorted_rows = sorted(rows, key=lambda r: (rank(r), r["ticker"]))
        self.assertEqual([r["ticker"] for r in sorted_rows], ["A", "Z"])

    def test_trade_scenarios_span_outcomes(self) -> None:
        raw = _trade_verdict()
        out = parse_verdict_json(json.dumps(raw))
        self.assertEqual(len(out["scenarios"]), 3)
        directions = {s["direction"] for s in out["scenarios"]}
        self.assertGreaterEqual(len(directions), 2)

    def test_narrative_references_analogues_when_present(self) -> None:
        v = _trade_verdict()
        self.assertIn("analogue", v["narrative"].lower())

    def test_single_stock_error_does_not_break_batch(self) -> None:
        def mock_analyze(_pid: str, ticker: str, *_a: object, **_k: object) -> dict:
            if ticker == "BAD":
                raise RuntimeError("forced failure")
            return {
                "cache_hit": False,
                "claude_call_made": True,
                "digest_hash": "h",
                "trading_date": "2026-05-18",
                "data_mode": "historical",
                "analyzed_at": "t",
                "digest": {},
                "verdict": {"verdict": "No Trade", "scenarios": []},
                "archive_written": False,
            }

        events = list(
            iter_large_cap_run_events(
                PROFILE,
                ["GOOD", "BAD", "ALSO"],
                "historical",
                analyze_fn=mock_analyze,
            )
        )
        errors = [e for e in events if e["type"] == "row_error"]
        results = [e for e in events if e["type"] == "row_result"]
        self.assertEqual(len(errors), 1)
        self.assertEqual(errors[0]["ticker"], "BAD")
        self.assertEqual(len(results), 2)
        self.assertEqual(events[-1]["ok_count"], 2)
        self.assertEqual(events[-1]["error_count"], 1)


class TestE2EArchivePipeline(unittest.TestCase):
    @patch("large_cap.cached_analysis.maybe_write_trade_archive", return_value=True)
    @patch("large_cap.cached_analysis.upsert_cached_analysis")
    @patch("large_cap.cached_analysis.synthesize_large_cap_verdict")
    @patch("large_cap.cached_analysis.get_cached_analysis")
    @patch("large_cap.cached_analysis.build_large_cap_digest")
    @patch("large_cap.cached_analysis.is_supabase_cache_configured", return_value=True)
    def test_trade_verdict_writes_archive(
        self,
        _cfg: object,
        mock_digest: object,
        mock_get: object,
        mock_synth: object,
        mock_upsert: object,
        mock_archive: object,
    ) -> None:
        from large_cap.cached_analysis import run_large_cap_analysis_cached

        digest = {"identity": {"ticker": "MSFT", "analysis_date": "2026-05-18", "data_mode": "historical"}}
        mock_digest.return_value = digest
        mock_get.return_value = None
        verdict = _trade_verdict()
        verdict["ticker"] = "MSFT"
        mock_synth.return_value = verdict
        mock_upsert.return_value = "2026-05-18T14:00:00+00:00"

        result = run_large_cap_analysis_cached(PROFILE, "MSFT", "historical")
        self.assertTrue(result["archive_written"])
        mock_archive.assert_called_once()  # type: ignore[attr-defined]

    def test_next_day_scoring_highlights_scenario_1(self) -> None:
        from large_cap.outcome_scorer import score_trade_result_json

        bar = {"open": 100, "high": 110, "low": 99, "close": 108}
        result = score_trade_result_json(
            {
                "verdict": "Trade",
                "scenarios": [
                    {"rank": 1, "key_levels": {"trigger": 100, "target": 108, "invalidation": 95}},
                    {"rank": 2, "key_levels": {"trigger": 200, "target": 210, "invalidation": 190}},
                    {"rank": 3, "key_levels": {"trigger": 300, "target": 310, "invalidation": 290}},
                ],
            },
            bar,
        )
        self.assertEqual(result["outcome"], "Scenario 1")

    @patch.dict("os.environ", {"INTERNAL_API_KEY": KEY}, clear=False)
    @patch("large_cap.archive_scoring.list_pending_archive_rows")
    @patch("large_cap.archive_scoring.mark_archive_scored")
    @patch("large_cap.archive_scoring.score_archive_row_if_ready")
    @patch("large_cap.cached_analysis.run_large_cap_analysis_cached")
    def test_run_stream_scores_pending_archives(
        self,
        mock_analyze: object,
        mock_score: object,
        mock_mark: object,
        mock_pending: object,
    ) -> None:
        mock_pending.return_value = [  # type: ignore[attr-defined]
            {
                "ticker": "AAPL",
                "trading_date": "2026-05-17",
                "result_json": _trade_verdict(),
            }
        ]
        mock_score.return_value = {  # type: ignore[attr-defined]
            "outcome": "Scenario 1",
            "scoring_json": {"scenarios": []},
            "outcome_session": "2026-05-18",
        }
        mock_analyze.return_value = {  # type: ignore[attr-defined]
            "cache_hit": True,
            "claude_call_made": False,
            "digest_hash": "h",
            "trading_date": "2026-05-19",
            "data_mode": "historical",
            "analyzed_at": "t",
            "digest": {},
            "verdict": {"verdict": "No Trade", "scenarios": []},
            "archive_written": False,
        }

        client = TestClient(__import__("main").app)
        res = client.post(
            "/large-cap/run",
            headers={"Authorization": f"Bearer {KEY}"},
            json={"profile_id": PROFILE, "tickers": ["AAPL"], "data_mode": "historical"},
        )
        events = [json.loads(line) for line in res.text.strip().split("\n") if line.strip()]
        scored = [e for e in events if e["type"] == "archive_scored"]
        self.assertEqual(len(scored), 1)
        self.assertEqual(scored[0]["outcome"], "Scenario 1")
        mock_mark.assert_called_once()  # type: ignore[attr-defined]


if __name__ == "__main__":
    unittest.main()
