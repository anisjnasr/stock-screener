"""Normalize decision_levels for the Key Levels UI (role / source / price|zone)."""

from __future__ import annotations

import re
from typing import Any, Optional

_ROLE_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"invalidation|support|floor|breakdown|stop", re.I), "Invalidation"),
    (re.compile(r"trigger|breakout|break above|entry|ceiling", re.I), "Trigger"),
    (re.compile(r"target|resistance|objective|measured move", re.I), "Target"),
    (re.compile(r"consolidation|range|zone|band", re.I), "Range"),
]


def _as_str(v: Any) -> str:
    return v.strip() if isinstance(v, str) else ""


def _infer_role(text: str) -> Optional[str]:
    for pattern, role in _ROLE_PATTERNS:
        if pattern.search(text):
            return role
    return None


def _split_legacy_label(label: str) -> dict[str, str]:
    parts = [p.strip() for p in re.split(r"\s*[—–-]\s*", label) if p.strip()]
    if len(parts) >= 2:
        first, second = parts[0], " - ".join(parts[1:])
        role_from_second = _infer_role(second)
        role_from_first = _infer_role(first)
        if role_from_second:
            return {"role": role_from_second, "source": first}
        if role_from_first:
            return {"role": role_from_first, "source": second}
        return {"role": second, "source": first}
    role = _infer_role(label)
    if role:
        return {"role": role, "source": label}
    return {"role": "Key level", "source": label}


def normalize_decision_level_item(item: dict[str, Any]) -> list[dict[str, Any]]:
    role = _as_str(item.get("role"))
    source = _as_str(item.get("source"))
    price = item.get("price")
    zone_low = item.get("zone_low")
    zone_high = item.get("zone_high")
    has_price = isinstance(price, (int, float))
    has_zone = isinstance(zone_low, (int, float)) and isinstance(zone_high, (int, float))

    if role and source and (has_price or has_zone):
        out: dict[str, Any] = {"role": role, "source": source}
        if has_price:
            out["price"] = float(price)
        if has_zone:
            lo = float(zone_low)
            hi = float(zone_high)
            out["zone_low"] = min(lo, hi)
            out["zone_high"] = max(lo, hi)
        return [out]

    label = _as_str(item.get("label"))
    if not label and not has_zone:
        return []

    if has_zone and not has_price:
        lo = float(zone_low)
        hi = float(zone_high)
        if lo > hi:
            lo, hi = hi, lo
        zone_source = label or "Price range"
        low_label = _as_str(item.get("low_label"))
        high_label = _as_str(item.get("high_label"))
        rows: list[dict[str, Any]] = []
        if low_label:
            split = _split_legacy_label(low_label)
            rows.append({"role": split["role"], "source": zone_source, "price": lo})
        if high_label:
            split = _split_legacy_label(high_label)
            rows.append({"role": split["role"], "source": zone_source, "price": hi})
        if not rows:
            rows.append({"role": "Range", "source": zone_source, "zone_low": lo, "zone_high": hi})
        return rows

    if has_price and label:
        split = _split_legacy_label(label)
        return [{"role": split["role"], "source": split["source"], "price": float(price)}]

    return []
