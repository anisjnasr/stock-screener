"""Tests for scenario A / bias alignment validation."""

from __future__ import annotations

import pytest

from large_cap.verdict_bias_alignment import (
    scenario_a_direction_aligns_with_bias,
    validate_scenario_a_bias_alignment,
)


def _trade_verdict(bias: str, direction: str) -> dict:
    return {
        "verdict": "Trade",
        "bias": bias,
        "ticker": "AMD",
        "scenarios": [
            {
                "label": "A",
                "direction": direction,
                "confidence": "High",
                "title": "Test scenario",
                "trigger": 100.0,
                "target": 110.0,
                "stop": 95.0,
                "range": None,
            },
            {
                "label": "B",
                "direction": "Short",
                "confidence": "Medium",
                "title": "Alt path",
                "trigger": None,
                "target": None,
                "stop": None,
                "range": None,
            },
            {
                "label": "C",
                "direction": "Either",
                "confidence": "Low",
                "title": "Consolidation",
                "trigger": None,
                "target": None,
                "stop": None,
                "range": None,
            },
        ],
    }


@pytest.mark.parametrize(
    ("bias", "direction", "expected"),
    [
        ("Bullish", "Long", True),
        ("Bullish", "Either", True),
        ("Bullish", "Short", False),
        ("Bearish", "Short", True),
        ("Bearish", "Either", True),
        ("Bearish", "Long", False),
        ("Neutral", "Long", True),
        ("Neutral", "Short", True),
        ("Neutral", "Either", True),
    ],
)
def test_scenario_a_direction_aligns_with_bias(bias: str, direction: str, expected: bool) -> None:
    assert scenario_a_direction_aligns_with_bias(bias, direction) is expected


def test_validate_passes_when_aligned() -> None:
    validate_scenario_a_bias_alignment(_trade_verdict("Bearish", "Short"))


def test_validate_rejects_bearish_long_mismatch() -> None:
    with pytest.raises(ValueError, match="contradicts bias 'Bearish'"):
        validate_scenario_a_bias_alignment(_trade_verdict("Bearish", "Long"))


def test_validate_rejects_bullish_short_mismatch() -> None:
    with pytest.raises(ValueError, match="contradicts bias 'Bullish'"):
        validate_scenario_a_bias_alignment(_trade_verdict("Bullish", "Short"))


def test_validate_skips_no_trade() -> None:
    validate_scenario_a_bias_alignment({"verdict": "No Trade", "bias": "Bearish", "scenarios": []})
