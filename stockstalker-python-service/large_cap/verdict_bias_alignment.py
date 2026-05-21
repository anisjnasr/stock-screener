"""Validate scenario A direction aligns with verdict bias."""

from __future__ import annotations

import logging
from typing import Any, Literal, Optional

logger = logging.getLogger(__name__)

Bias = Literal["Bullish", "Bearish", "Neutral"]
Direction = Literal["Long", "Short", "Either"]


def scenario_a_direction_aligns_with_bias(bias: str, direction: str) -> bool:
    """Either always passes; Bullish requires Long; Bearish requires Short; Neutral allows any."""
    if direction == "Either":
        return True
    if bias == "Bullish":
        return direction == "Long"
    if bias == "Bearish":
        return direction == "Short"
    return True


def _scenario_a(scenarios: list[Any]) -> Optional[dict[str, Any]]:
    for item in scenarios:
        if isinstance(item, dict) and item.get("label") == "A":
            return item
    first = scenarios[0] if scenarios else None
    return first if isinstance(first, dict) else None


def validate_scenario_a_bias_alignment(verdict: dict[str, Any]) -> None:
    """
    Reject Trade verdicts where rank-1 scenario direction contradicts bias.
    Raises ValueError on mismatch (logged at error level).
    """
    if verdict.get("verdict") != "Trade":
        return

    bias = verdict.get("bias")
    if bias not in ("Bullish", "Bearish", "Neutral"):
        return

    scenarios = verdict.get("scenarios")
    if not isinstance(scenarios, list) or not scenarios:
        return

    scenario_a = _scenario_a(scenarios)
    if not scenario_a:
        return

    direction = scenario_a.get("direction")
    if direction not in ("Long", "Short", "Either"):
        return

    if scenario_a_direction_aligns_with_bias(bias, direction):
        return

    ticker = str(verdict.get("ticker") or "?")
    logger.error(
        "large_cap_bias_scenario_mismatch ticker=%s bias=%s scenario_a_direction=%s scenario_a_label=%s",
        ticker,
        bias,
        direction,
        scenario_a.get("label"),
    )
    raise ValueError(
        f"Scenario A direction {direction!r} contradicts bias {bias!r} for {ticker}"
    )
