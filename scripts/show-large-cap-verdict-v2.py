#!/usr/bin/env python3
"""Build a digest and show merged v2 verdict JSON (Claude sample + server comps)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "stockstalker-python-service"
sys.path.insert(0, str(ROOT))

from large_cap.digest_builder import build_large_cap_digest, screener_db_path
from large_cap.verdict_finalize import attach_comps_to_verdict
from large_cap.verdict_schema_samples import sample_trade


def main() -> int:
    ticker = (sys.argv[1] if len(sys.argv) > 1 else "AAPL").upper()
    mode = sys.argv[2] if len(sys.argv) > 2 else "historical_premarket"

    if not screener_db_path().is_file():
        print(f"screener.db not found at {screener_db_path()} — using minimal digest stub.", file=sys.stderr)
        digest = {
            "identity": {"ticker": ticker, "analysis_date": "2026-05-20", "data_mode": mode},
            "premarket": {"last_price": 100.0, "gap_pct_vs_prior_close": 1.5},
            "historical_analogues": {
                "match_count": 18,
                "low_sample": True,
                "summary_tendencies": {
                    "follow_through_count": 10,
                    "reversed_count": 5,
                    "flat_or_chop_count": 3,
                    "avg_next_day_true_range_pct_of_open": 1.95,
                },
                "examples": [],
            },
        }
    else:
        digest = build_large_cap_digest(ticker, mode)  # type: ignore[arg-type]

    claude = sample_trade()
    claude["ticker"] = ticker
    data_mode = "historical_premarket" if mode == "historical_premarket" else "historical"
    verdict = attach_comps_to_verdict(claude, digest, data_mode=data_mode)  # type: ignore[arg-type]

    print(json.dumps(verdict, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
