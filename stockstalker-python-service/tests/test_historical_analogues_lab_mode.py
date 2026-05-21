"""Lab-mode lookahead-bias tests for the historical analogue comp engine."""

from __future__ import annotations

import sqlite3
import unittest
from datetime import date, timedelta
from typing import Any

from large_cap.digest_builder import Bar, _fetch_bars_before
from large_cap.historical_analogues import EXCLUDE_LAST_SESSIONS, compute_historical_analogues_block


def _weekday_dates(start: str, end: str) -> list[str]:
    cur = date.fromisoformat(start)
    end_d = date.fromisoformat(end)
    out: list[str] = []
    while cur <= end_d:
        if cur.weekday() < 5:
            out.append(cur.isoformat())
        cur += timedelta(days=1)
    return out


def _build_uptrend_fixture() -> tuple[list[Bar], dict[str, dict[str, Any]], dict[str, Any]]:
    """Synthetic history where many sessions share the same match signature."""
    dates = _weekday_dates("2020-01-02", "2024-06-30")
    bars: list[Bar] = []
    indicators: dict[str, dict[str, Any]] = {}
    for d in dates:
        px = 100.0
        bars.append(
            Bar(
                date=d,
                open=px,
                high=px + 0.5,
                low=px - 0.5,
                close=px,
                volume=1_000_000,
            )
        )
        indicators[d] = {
            "atr_21": 1.0,
            "ema_20": 95.0,
            "ema_50": 90.0,
            "ema_200": 85.0,
        }

    prior_date = dates[-1]
    digest: dict[str, Any] = {
        "identity": {
            "analysis_date": "2024-07-01",
            "data_mode": "historical",
        },
        "recent_price_structure": {
            "prior_day": {"date": prior_date, "close": 100.0},
        },
        "trend_and_momentum": {"trend_label": "uptrend"},
        "multi_timescale_ranges": {
            "short": {
                "high": 101.0,
                "low": 99.0,
                "tightness_range_vs_atr": 1.0,
            }
        },
    }
    return bars, indicators, digest


def _load_fixture_db(bars: list[Bar], indicators: dict[str, dict[str, Any]], symbol: str = "LAB") -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.executescript(
        """
        CREATE TABLE daily_bars (
          symbol TEXT, date TEXT, open REAL, high REAL, low REAL, close REAL, volume INTEGER
        );
        CREATE TABLE indicators_daily (
          symbol TEXT, date TEXT, atr_21 REAL, ema_20 REAL, ema_50 REAL, ema_200 REAL
        );
        """
    )
    for b in bars:
        conn.execute(
            """
            INSERT INTO daily_bars VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (symbol, b.date, b.open, b.high, b.low, b.close, b.volume),
        )
    for d, row in indicators.items():
        conn.execute(
            """
            INSERT INTO indicators_daily VALUES (?, ?, ?, ?, ?, ?)
            """,
            (symbol, d, row["atr_21"], row["ema_20"], row["ema_50"], row["ema_200"]),
        )
    return conn


def _all_example_dates(block: dict[str, Any]) -> list[str]:
    return [str(ex["analogue_session_date"]) for ex in block.get("examples", []) if ex.get("analogue_session_date")]


class TestHistoricalAnaloguesLabMode(unittest.TestCase):
    LAB_REF = "2023-06-15"

    def setUp(self) -> None:
        self.bars, self.indicators, self.digest = _build_uptrend_fixture()
        self.conn = _load_fixture_db(self.bars, self.indicators)

    def tearDown(self) -> None:
        self.conn.close()

    def test_live_mode_unchanged_no_lab_field(self) -> None:
        block = compute_historical_analogues_block(
            None,
            "LAB",
            self.bars,
            self.digest,
            indicators_by_date=self.indicators,
        )
        self.assertGreater(block["match_count"], 0)
        self.assertNotIn("lab_mode_reference_date", block)

    def test_lab_mode_in_memory_cutoff(self) -> None:
        block = compute_historical_analogues_block(
            None,
            "LAB",
            self.bars,
            self.digest,
            indicators_by_date=self.indicators,
            lab_mode_reference_date=self.LAB_REF,
        )
        self.assertEqual(block.get("lab_mode_reference_date"), self.LAB_REF)
        self.assertGreater(block["match_count"], 0)
        matches = block.get("matches")
        self.assertIsInstance(matches, list)
        self.assertEqual(len(matches), block["match_count"])
        if matches:
            self.assertIn("setup_signature", matches[0])
            self.assertIn("similarity_score", matches[0])
        self.assertIn("reference_setup_signature", block)
        span = block.get("lookback_span") or {}
        newest = span.get("newest_analogue_session")
        self.assertIsNotNone(newest)
        self.assertLess(str(newest), self.LAB_REF)
        for d in _all_example_dates(block):
            self.assertLess(d, self.LAB_REF)

    def test_lab_mode_db_fetch_cutoff(self) -> None:
        """Data-fetch layer: engine re-queries SQLite with date < lab ref."""
        block = compute_historical_analogues_block(
            self.conn,
            "LAB",
            self.bars,
            self.digest,
            lab_mode_reference_date=self.LAB_REF,
        )
        self.assertGreater(block["match_count"], 0)
        fetched = _fetch_bars_before(self.conn, "LAB", self.LAB_REF)
        self.assertTrue(all(b.date < self.LAB_REF for b in fetched))
        span = block.get("lookback_span") or {}
        self.assertLess(str(span.get("newest_analogue_session")), self.LAB_REF)

    def test_lab_mode_excludes_post_ref_matches_that_live_would_include(self) -> None:
        live = compute_historical_analogues_block(
            None,
            "LAB",
            self.bars,
            self.digest,
            indicators_by_date=self.indicators,
        )
        lab = compute_historical_analogues_block(
            None,
            "LAB",
            self.bars,
            self.digest,
            indicators_by_date=self.indicators,
            lab_mode_reference_date=self.LAB_REF,
        )
        live_newest = str((live.get("lookback_span") or {}).get("newest_analogue_session"))
        lab_newest = str((lab.get("lookback_span") or {}).get("newest_analogue_session"))
        self.assertGreaterEqual(live_newest, self.LAB_REF)
        self.assertLess(lab_newest, self.LAB_REF)
        self.assertGreater(live["match_count"], lab["match_count"])

    def test_lab_mode_logs_reference_date(self) -> None:
        with self.assertLogs("large_cap.historical_analogues", level="INFO") as logs:
            compute_historical_analogues_block(
                self.conn,
                "LAB",
                self.bars,
                self.digest,
                lab_mode_reference_date=self.LAB_REF,
            )
        joined = "\n".join(logs.output)
        self.assertIn("lab_mode_reference_date=2023-06-15", joined)

    def test_lab_mode_no_result_on_or_after_reference_date(self) -> None:
        """Blueprint §8: automated proof that lab mode never returns comps >= reference date."""
        block = compute_historical_analogues_block(
            self.conn,
            "LAB",
            self.bars,
            self.digest,
            lab_mode_reference_date=self.LAB_REF,
        )
        ref = self.LAB_REF
        span = block.get("lookback_span") or {}
        for key in ("oldest_analogue_session", "newest_analogue_session", "scan_latest_eligible_anchor_session"):
            val = span.get(key)
            if val:
                self.assertLess(str(val), ref, msg=f"{key}={val} must be < {ref}")
        for ex in block.get("examples", []):
            ad = str(ex.get("analogue_session_date") or "")
            nd = str(ex.get("next_session_date") or "")
            if ad:
                self.assertLess(ad, ref)
            if nd:
                self.assertLess(nd, ref)

    def test_fetch_bars_before_excludes_reference_date(self) -> None:
        fetched = _fetch_bars_before(self.conn, "LAB", self.LAB_REF)
        min_bars = EXCLUDE_LAST_SESSIONS + 20
        self.assertGreater(len(fetched), min_bars)
        self.assertTrue(all(b.date < self.LAB_REF for b in fetched))
        self.assertEqual(fetched[-1].date, "2023-06-14")


if __name__ == "__main__":
    unittest.main()
