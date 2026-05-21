"""Map digest `historical_analogues` → UI `comps` shape (server-injected, not from Claude)."""

from __future__ import annotations

from typing import Any, Literal, Optional

CompsOutcome = Literal["follow_through", "reversal", "flat"]

_OUTCOME_MAP: dict[str, CompsOutcome] = {
    "follow_through": "follow_through",
    "reversed": "reversal",
    "neutral_chop": "flat",
}


def _safe_float(v: Any) -> Optional[float]:
    if isinstance(v, (int, float)) and v == v:
        return float(v)
    return None


def _avg(values: list[float]) -> float:
    if not values:
        return 0.0
    return round(sum(values) / len(values), 4)


def map_historical_analogues_to_comps(block: Any) -> dict[str, Any]:
    """
    Transform digest.historical_analogues into verdict.comps for the UI.

    Digest field `historical_analogues` is unchanged; this produces the display field `comps`.
    """
    if not isinstance(block, dict):
        block = {}

    tend = block.get("summary_tendencies") if isinstance(block.get("summary_tendencies"), dict) else {}
    follow_through = int(tend.get("follow_through_count") or 0)
    reversal = int(tend.get("reversed_count") or 0)
    flat = int(tend.get("flat_or_chop_count") or 0)
    total = int(block.get("match_count") if block.get("match_count") is not None else follow_through + reversal + flat)

    if follow_through + reversal + flat != total:
        total = follow_through + reversal + flat

    avg_range = _safe_float(tend.get("avg_next_day_true_range_pct_of_open")) or 0.0

    examples_raw = block.get("examples") if isinstance(block.get("examples"), list) else []
    ft_pcts: list[float] = []
    rev_pcts: list[float] = []
    recent_examples: list[dict[str, Any]] = []

    for ex in examples_raw[:3]:
        if not isinstance(ex, dict):
            continue
        ns = ex.get("next_session") if isinstance(ex.get("next_session"), dict) else {}
        raw_label = str(ns.get("follow_through_label") or "")
        outcome = _OUTCOME_MAP.get(raw_label, "flat")
        outcome_pct = _safe_float(ns.get("close_vs_open_pct")) or 0.0
        comp_gap_pct = _safe_float(ex.get("overnight_gap_pct_into_next_session")) or 0.0
        date = str(ex.get("analogue_session_date") or "").strip()
        if not date:
            continue
        recent_examples.append(
            {
                "date": date,
                "comp_gap_pct": round(comp_gap_pct, 4),
                "outcome": outcome,
                "outcome_pct": round(outcome_pct, 4),
            }
        )

    for ex in examples_raw:
        if not isinstance(ex, dict):
            continue
        ns = ex.get("next_session") if isinstance(ex.get("next_session"), dict) else {}
        raw_label = str(ns.get("follow_through_label") or "")
        pct = _safe_float(ns.get("close_vs_open_pct"))
        if pct is None:
            continue
        if raw_label == "follow_through":
            ft_pcts.append(abs(pct))
        elif raw_label == "reversed":
            rev_pcts.append(abs(pct))

    low_sample = bool(block.get("low_sample")) or total < 20

    return {
        "total": total,
        "follow_through": follow_through,
        "reversal": reversal,
        "flat": flat,
        "avg_next_day_range_pct": round(avg_range, 4),
        "avg_follow_through_pct": _avg(ft_pcts),
        "avg_reversal_pct": _avg(rev_pcts),
        "recent_examples": recent_examples,
        "low_sample": low_sample,
    }
