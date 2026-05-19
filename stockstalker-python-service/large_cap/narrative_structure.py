"""
Ensure Large Cap verdicts expose structured narrative_sections for the UI.

Claude may still return a legacy single `narrative` string; this module splits and
enriches it using digest facts when needed.
"""

from __future__ import annotations

import re
from typing import Any, Literal, Optional

from large_cap.decision_levels import normalize_decision_level_item
from large_cap.level_source_catalog import (
    collect_digest_level_catalog,
    enrich_level_source,
    match_price_to_digest_source,
)

DataMode = Literal["historical", "historical_premarket"]

_SECTION_KEYS = ("big_picture", "recent_action", "historical_analogues", "pre_market")

_ROUTE_ORDER = ("historical_analogues", "pre_market", "recent_action", "big_picture")

_ROUTE_PATTERNS: dict[str, re.Pattern[str]] = {
    "historical_analogues": re.compile(
        r"\b(analogue|analog|precedent|comparable|match_count|similar setup|prior instance|"
        r"historical|followed through|reversed on|precedents?)\b",
        re.I,
    ),
    "pre_market": re.compile(
        r"\b(pre-?market|premarket|\bgap\b|overnight|pm volume|pm vol|before the open|"
        r"relative volume|rvol)\b",
        re.I,
    ),
    "recent_action": re.compile(
        r"\b(yesterday|last session|prior session|recent|last few|prior day|range expansion|"
        r"true range|tr vs|prior close|inside day|last close|prior session)\b",
        re.I,
    ),
    "big_picture": re.compile(
        r"\b(base|multi-?month|timescale|range|trend|ema|structure|52-?week|longer|"
        r"intermediate|consolidat|sideways|window|long_base)\b",
        re.I,
    ),
}

_DISTRIBUTE_ORDER = ("big_picture", "recent_action", "historical_analogues", "pre_market")


def _as_str(v: Any) -> str:
    return v.strip() if isinstance(v, str) else ""


def _split_sentences(text: str) -> list[str]:
    parts: list[str] = []
    for para in re.split(r"\n+", text.strip()):
        p = para.strip()
        if not p:
            continue
        parts.extend(m.strip() for m in re.findall(r"[^.!?]+[.!?]+|[^.!?]+$", p) if m.strip())
    return parts


def _join(parts: list[str]) -> str:
    return " ".join(p for p in parts if p).strip()


def _sections_from_dict(raw: Any) -> dict[str, str]:
    if not isinstance(raw, dict):
        return {k: "" for k in _SECTION_KEYS}
    return {k: _as_str(raw.get(k)) for k in _SECTION_KEYS}


def _sections_usable(sections: dict[str, str]) -> bool:
    filled = [k for k in _SECTION_KEYS if sections.get(k)]
    if len(filled) < 2:
        return False
    total = sum(len(sections[k]) for k in _SECTION_KEYS)
    bp = len(sections.get("big_picture", ""))
    if bp and len(filled) <= 2 and total > 0 and bp / total > 0.85:
        return False
    return True


def split_narrative_into_sections(narrative: str) -> dict[str, str]:
    sentences = _split_sentences(narrative)
    buckets: dict[str, list[str]] = {k: [] for k in _SECTION_KEYS}
    unassigned: list[str] = []

    for sentence in sentences:
        placed = False
        for key in _ROUTE_ORDER:
            if _ROUTE_PATTERNS[key].search(sentence):
                buckets[key].append(sentence)
                placed = True
                break
        if not placed:
            unassigned.append(sentence)

    for i, sentence in enumerate(unassigned):
        buckets[_DISTRIBUTE_ORDER[i % len(_DISTRIBUTE_ORDER)]].append(sentence)

    return {k: _join(buckets[k]) for k in _SECTION_KEYS}


def _fmt_price(n: Any) -> str:
    if isinstance(n, (int, float)) and n == n:
        return f"${float(n):.2f}"
    return "—"


def _digest_section_fallbacks(digest: dict[str, Any], data_mode: DataMode) -> dict[str, str]:
    out = {k: "" for k in _SECTION_KEYS}

    trend = _as_str((digest.get("trend_and_momentum") or {}).get("trend_label"))
    multi = digest.get("multi_timescale_ranges") or {}
    short = multi.get("short") or {}
    longer = multi.get("longer") or {}
    base = multi.get("long_base") or {}
    if trend or short or longer:
        bits = []
        if trend:
            bits.append(f"Trend label: {trend}.")
        if short.get("high") is not None and short.get("low") is not None:
            bits.append(
                f"Short window ({multi.get('short_sessions', '?')} sessions): "
                f"{_fmt_price(short.get('low'))}–{_fmt_price(short.get('high'))}."
            )
        if longer.get("high") is not None and longer.get("low") is not None:
            bits.append(
                f"Longer window ({multi.get('longer_sessions', '?')} sessions): "
                f"{_fmt_price(longer.get('low'))}–{_fmt_price(longer.get('high'))}."
            )
        if base.get("high") is not None and base.get("low") is not None:
            bits.append(
                f"Long base ({multi.get('long_base_sessions', '?')} sessions): "
                f"{_fmt_price(base.get('low'))}–{_fmt_price(base.get('high'))}."
            )
        out["big_picture"] = " ".join(bits)

    recent = digest.get("recent_price_structure") or {}
    prior = recent.get("prior_day") or {}
    vol = digest.get("volatility_and_range") or {}
    recent_bits = []
    if prior.get("close") is not None:
        recent_bits.append(f"Prior session close {_fmt_price(prior.get('close'))}.")
    chg = recent.get("last_close_vs_prior_session_close_pct")
    if isinstance(chg, (int, float)):
        recent_bits.append(f"Last close vs prior session: {float(chg):+.2f}%.")
    tr_ratio = vol.get("prior_session_tr_vs_atr_ratio")
    if isinstance(tr_ratio, (int, float)):
        recent_bits.append(f"Prior session TR/ATR ratio: {float(tr_ratio):.2f}.")
    if recent_bits:
        out["recent_action"] = " ".join(recent_bits)

    analogues = digest.get("historical_analogues") or {}
    mc = analogues.get("match_count")
    if isinstance(mc, int):
        tend = analogues.get("summary_tendencies") or {}
        ft = tend.get("follow_through_count")
        rev = tend.get("reversed_count")
        chop = tend.get("flat_or_chop_count")
        low = analogues.get("low_sample")
        bits = [f"{mc} comparable analogue{'s' if mc != 1 else ''}."]
        if isinstance(ft, int) and isinstance(rev, int) and isinstance(chop, int) and mc > 0:
            bits.append(f"Next session: {ft} follow-through, {rev} reversed, {chop} chop.")
        if low:
            bits.append("Low sample — treat as weak evidence.")
        out["historical_analogues"] = " ".join(bits)

    if data_mode == "historical_premarket":
        pm = digest.get("premarket") or {}
        pm_bits = []
        if pm.get("last_price") is not None:
            pm_bits.append(f"Pre-market last {_fmt_price(pm.get('last_price'))}.")
        gap = pm.get("gap_pct_vs_prior_close")
        if isinstance(gap, (int, float)):
            pm_bits.append(f"Gap vs prior close: {float(gap):+.2f}%.")
        if pm.get("volume") is not None:
            pm_bits.append(f"Pre-market volume {int(pm['volume']):,}.")
        rvol = pm.get("relative_volume_vs_baseline")
        if isinstance(rvol, (int, float)):
            pm_bits.append(f"Relative volume vs baseline: {float(rvol):.2f}x.")
        if pm.get("premarket_changes_picture") is True:
            pm_bits.append("Pre-market changes the historical read.")
        if pm_bits:
            out["pre_market"] = " ".join(pm_bits)
    elif data_mode == "historical":
        out["pre_market"] = "Historical-only mode — no pre-market data in this run."

    return out


def _fill_empty_sections(sections: dict[str, str], digest: Optional[dict[str, Any]], data_mode: DataMode) -> dict[str, str]:
    if not digest:
        return sections
    fallbacks = _digest_section_fallbacks(digest, data_mode)
    for key in _SECTION_KEYS:
        if not sections.get(key) and fallbacks.get(key):
            sections[key] = fallbacks[key]
    return sections


def _finalize_decision_levels(
    levels: list[dict[str, Any]],
    digest: Optional[dict[str, Any]],
) -> list[dict[str, Any]]:
    if not digest:
        return levels
    return [enrich_level_source(level, digest) for level in levels]


def _levels_from_scenario_key_levels(
    kl: dict[str, Any],
    digest: Optional[dict[str, Any]],
) -> list[dict[str, Any]]:
    catalog = collect_digest_level_catalog(digest) if digest else []
    out: list[dict[str, Any]] = []
    for role, key in (("Trigger", "trigger"), ("Target", "target"), ("Invalidation", "invalidation")):
        val = kl.get(key)
        if not isinstance(val, (int, float)):
            continue
        price = float(val)
        source = match_price_to_digest_source(price, catalog) if catalog else None
        out.append({"role": role, "source": source or "Structural level", "price": price})
    return out[:3]


def infer_decision_levels(
    verdict: dict[str, Any],
    digest: Optional[dict[str, Any]] = None,
) -> list[dict[str, Any]]:
    existing = verdict.get("decision_levels")
    if isinstance(existing, list) and existing:
        out: list[dict[str, Any]] = []
        for item in existing[:3]:
            if not isinstance(item, dict):
                continue
            out.extend(normalize_decision_level_item(item))
            if len(out) >= 3:
                break
        if out:
            return _finalize_decision_levels(out[:3], digest)

    scenarios = verdict.get("scenarios")
    if isinstance(scenarios, list) and scenarios:
        rank1 = next((s for s in scenarios if isinstance(s, dict) and s.get("rank") == 1), None)
        if rank1 is None and scenarios:
            rank1 = scenarios[0] if isinstance(scenarios[0], dict) else None
        if isinstance(rank1, dict):
            kl = rank1.get("key_levels") or {}
            if isinstance(kl, dict):
                out = _levels_from_scenario_key_levels(kl, digest)
                if out:
                    return _finalize_decision_levels(out, digest)

    if digest:
        multi = digest.get("multi_timescale_ranges") or {}
        short = multi.get("short") or {}
        sh = short.get("high")
        sl = short.get("low")
        tightness = short.get("tightness_range_vs_atr")
        sessions = multi.get("short_sessions")
        if isinstance(sh, (int, float)) and isinstance(sl, (int, float)):
            if isinstance(tightness, (int, float)) and tightness <= 1.5:
                return [
                    {
                        "role": "Range",
                        "source": f"{sessions}-session consolidation area"
                        if sessions
                        else "Short-window consolidation area",
                        "zone_low": float(sl),
                        "zone_high": float(sh),
                    }
                ]

        kl = digest.get("key_levels") or {}
        out = []
        pdh = kl.get("prior_day_high")
        pdl = kl.get("prior_day_low")
        if isinstance(pdh, (int, float)):
            out.append({"role": "Trigger", "source": "Prior day high", "price": float(pdh)})
        if isinstance(pdl, (int, float)):
            out.append({"role": "Invalidation", "source": "Prior day low", "price": float(pdl)})
        swing_hi = kl.get("recent_swing_high")
        swing_lo = kl.get("recent_swing_low")
        if isinstance(swing_hi, (int, float)) and isinstance(swing_lo, (int, float)) and len(out) < 2:
            return [
                {
                    "role": "Range",
                    "source": "Recent swing range",
                    "zone_low": float(swing_lo),
                    "zone_high": float(swing_hi),
                }
            ]
        if out:
            return out[:3]

    return []


def ensure_structured_narrative(
    verdict: dict[str, Any],
    digest: Optional[dict[str, Any]] = None,
    *,
    data_mode: DataMode = "historical",
) -> dict[str, Any]:
    """Return a copy of verdict with narrative_sections and decision_levels populated."""
    out = dict(verdict)
    narrative = _as_str(out.get("narrative"))
    sections = _sections_from_dict(out.get("narrative_sections"))

    if not _sections_usable(sections):
        source = narrative or sections.get("big_picture") or sections.get("recent_action") or ""
        if source:
            sections = split_narrative_into_sections(source)
        elif digest:
            sections = _digest_section_fallbacks(digest, data_mode)

    sections = _fill_empty_sections(sections, digest, data_mode)
    out["narrative_sections"] = sections

    levels = infer_decision_levels(out, digest)
    if levels:
        out["decision_levels"] = levels

    if not _as_str(out.get("narrative")):
        out["narrative"] = " ".join(_as_str(sections[k]) for k in _SECTION_KEYS if _as_str(sections[k]))

    return out
