"""Merge server-side fields into Claude §9 verdict and validate the UI contract."""

from __future__ import annotations

from typing import Any, Literal, Optional

from large_cap.claude_synthesis import ClaudeLargeCapVerdictJson, CompsOut, LargeCapVerdictJson
from large_cap.comps_mapping import map_historical_analogues_to_comps
from large_cap.narrative_structure import ensure_structured_narrative
from large_cap.verdict_bias_alignment import validate_scenario_a_bias_alignment

DataMode = Literal["historical", "historical_premarket"]


def _is_v2_verdict(verdict: dict[str, Any]) -> bool:
    return isinstance(verdict.get("big_picture"), str) or isinstance(verdict.get("recent_action"), list)


def _strip_premarket_if_absent(verdict: dict[str, Any], digest: dict[str, Any], data_mode: DataMode) -> None:
    pm = digest.get("premarket")
    has_pm = isinstance(pm, dict) and pm.get("last_price") is not None
    if data_mode == "historical" or not has_pm:
        verdict.pop("pre_market", None)


def attach_comps_to_verdict(
    claude_verdict: dict[str, Any],
    digest: dict[str, Any],
    *,
    data_mode: DataMode = "historical",
) -> dict[str, Any]:
    """
    Build the UI verdict: Claude fields + server-injected comps from digest.historical_analogues.
    Validates against LargeCapVerdictJson; raises ValueError on failure.
    """
    merged = dict(claude_verdict)
    merged.pop("comps", None)
    _strip_premarket_if_absent(merged, digest, data_mode)

    ClaudeLargeCapVerdictJson.model_validate(merged)
    validate_scenario_a_bias_alignment(merged)

    analogues = digest.get("historical_analogues")
    comps_raw = map_historical_analogues_to_comps(analogues)
    CompsOut.model_validate(comps_raw)
    merged["comps"] = comps_raw

    validated = LargeCapVerdictJson.model_validate(merged)
    return validated.model_dump(exclude_none=True)


def finalize_large_cap_verdict(
    verdict: dict[str, Any],
    digest: Optional[dict[str, Any]] = None,
    *,
    data_mode: DataMode = "historical",
) -> dict[str, Any]:
    """Return v2 verdict with comps, or legacy narrative normalization."""
    if not isinstance(verdict, dict):
        raise ValueError("verdict must be an object")
    if _is_v2_verdict(verdict):
        if not digest:
            raise ValueError("digest is required to finalize v2 verdict")
        return attach_comps_to_verdict(verdict, digest, data_mode=data_mode)
    return ensure_structured_narrative(verdict, digest, data_mode=data_mode)
