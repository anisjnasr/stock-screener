"""Stage 7 verification — batch run orchestrator, streaming events, error isolation."""

from __future__ import annotations

import threading
import time
import unittest

from large_cap.run_orchestrator import (
    clamp_concurrency,
    encode_ndjson_event,
    iter_large_cap_run_events,
    normalize_tickers,
)


PROFILE = "550e8400-e29b-41d4-a716-446655440000"


def _collect_events(**kwargs: object) -> list[dict]:
    return list(iter_large_cap_run_events(PROFILE, ["AAPL", "MSFT"], "historical", **kwargs))


class TestNormalizeTickers(unittest.TestCase):
    def test_dedup_and_uppercase(self) -> None:
        self.assertEqual(normalize_tickers(["aapl", "AAPL", " msft "]), ["AAPL", "MSFT"])

    def test_skips_invalid(self) -> None:
        self.assertEqual(normalize_tickers(["", "!!!", "TOOLONGSYMBOLX"]), [])


class TestClampConcurrency(unittest.TestCase):
    def test_defaults_and_bounds(self) -> None:
        self.assertEqual(clamp_concurrency(None), 5)
        self.assertEqual(clamp_concurrency(0), 1)
        self.assertEqual(clamp_concurrency(99), 8)


class TestRunOrchestrator(unittest.TestCase):
    def test_success_stream_shape(self) -> None:
        def mock_analyze(*_a: object, **_k: object) -> dict:
            return {
                "cache_hit": True,
                "claude_call_made": False,
                "digest_hash": "abc",
                "trading_date": "2026-05-18",
                "data_mode": "historical",
                "analyzed_at": "2026-05-18T12:00:00+00:00",
                "digest": {"identity": {"ticker": "X"}},
                "verdict": {"verdict": "No Trade", "scenarios": []},
            }

        events = _collect_events(analyze_fn=mock_analyze, concurrency=2)
        types = [e["type"] for e in events]
        self.assertEqual(types[0], "run_started")
        self.assertEqual(types[-1], "run_complete")
        self.assertIn("row_result", types)
        self.assertNotIn("row_error", types)
        self.assertEqual(events[-1]["ok_count"], 2)
        self.assertEqual(events[-1]["error_count"], 0)

    def test_error_isolation(self) -> None:
        def mock_analyze(_pid: str, ticker: str, *_a: object, **_k: object) -> dict:
            if ticker == "MSFT":
                raise ValueError("bad data for MSFT")
            return {
                "cache_hit": False,
                "claude_call_made": True,
                "digest_hash": "h",
                "trading_date": "2026-05-18",
                "data_mode": "historical",
                "analyzed_at": "t",
                "digest": {},
                "verdict": {"verdict": "No Trade"},
            }

        events = _collect_events(analyze_fn=mock_analyze)
        errors = [e for e in events if e["type"] == "row_error"]
        results = [e for e in events if e["type"] == "row_result"]
        self.assertEqual(len(errors), 1)
        self.assertEqual(errors[0]["ticker"], "MSFT")
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["ticker"], "AAPL")
        self.assertEqual(events[-1]["ok_count"], 1)
        self.assertEqual(events[-1]["error_count"], 1)

    def test_concurrency_cap(self) -> None:
        lock = threading.Lock()
        active = 0
        peak = 0

        def mock_analyze(*_a: object, **_k: object) -> dict:
            nonlocal active, peak
            with lock:
                active += 1
                peak = max(peak, active)
            time.sleep(0.05)
            with lock:
                active -= 1
            return {
                "cache_hit": True,
                "claude_call_made": False,
                "digest_hash": "h",
                "trading_date": "2026-05-18",
                "data_mode": "historical",
                "analyzed_at": "t",
                "digest": {},
                "verdict": {},
            }

        tickers = [f"T{i}" for i in range(8)]
        list(
            iter_large_cap_run_events(
                PROFILE,
                tickers,
                "historical",
                analyze_fn=mock_analyze,
                concurrency=3,
            )
        )
        self.assertLessEqual(peak, 3)

    def test_invalid_profile_raises(self) -> None:
        with self.assertRaises(ValueError):
            list(iter_large_cap_run_events("not-a-uuid", ["AAPL"], "historical"))

    def test_ndjson_line(self) -> None:
        line = encode_ndjson_event({"type": "run_started", "total": 1})
        self.assertTrue(line.endswith("\n"))
        self.assertIn('"type":"run_started"', line)


if __name__ == "__main__":
    unittest.main()
