"""Sample §9 verdict payloads for tests (v2 structured schema)."""

from __future__ import annotations


def sample_no_trade() -> dict:
    return {
        "ticker": "AAPL",
        "verdict": "No Trade",
        "verdict_reason": "Rangebound across all windows.",
        "bias": "Neutral",
        "big_picture": "Stock sits inside its multi-month base with a neutral MA stack.",
        "recent_action": [
            "Prior session closed mid-range.",
            "Four-day window remains tight vs ATR.",
            "Volume has declined for three sessions.",
        ],
        "key_levels": [],
        "scenarios": [],
    }


def sample_trade() -> dict:
    return {
        "ticker": "MU",
        "verdict": "Trade",
        "verdict_reason": "Pre-market gap clears the short-window range.",
        "bias": "Bullish",
        "big_picture": "MU is consolidating inside a multi-month base with price above the 50-day EMA.",
        "recent_action": [
            "Prior session closed +1.2% vs the session before.",
            "True range was 1.4× the 21-day ATR.",
            "High of last five sessions is 98.40.",
        ],
        "pre_market": [
            "Gap +2.1% vs prior close.",
            "Pre-market last 100.50.",
            "Pre-market volume 1.8× typical baseline.",
        ],
        "key_levels": [
            {"role": "Trigger", "source": "Prior day high", "price": 98.4},
            {"role": "Target", "source": "55-session range high", "price": 102.5},
            {"role": "Stop", "source": "Prior day low", "price": 96.1},
            {"role": "Support", "source": "20-day EMA", "price": 95.8},
        ],
        "scenarios": [
            {
                "label": "A",
                "direction": "Long",
                "confidence": "High",
                "title": "Gap holds and breaks higher",
                "trigger": 98.4,
                "target": 102.5,
                "stop": 96.1,
                "range": None,
            },
            {
                "label": "B",
                "direction": "Short",
                "confidence": "Medium",
                "title": "Gap fills and reverses",
                "trigger": 96.1,
                "target": 94.0,
                "stop": 99.0,
                "range": None,
            },
            {
                "label": "C",
                "direction": "Either",
                "confidence": "Low",
                "title": "Chops inside opening range",
                "trigger": None,
                "target": None,
                "stop": None,
                "range": [96.5, 99.5],
            },
        ],
    }
