"""Map scenario / decision prices to digest structural level labels."""

from __future__ import annotations

from typing import Any, Optional

CatalogEntry = tuple[float, str]

_GENERIC_SOURCES = frozenset(
    {
        "",
        "primary scenario",
        "scenario",
        "key level",
        "structural level",
        "price level",
        "rank-1 scenario",
    }
)

_EMA_LABELS = {
    "ema_20": "20-day EMA",
    "ema_50": "50-day EMA",
    "ema_100": "100-day EMA",
    "ema_200": "200-day EMA",
}


def price_match_tolerance(price: float) -> float:
    return max(0.02, abs(price) * 0.001)


def _safe_float(v: Any) -> Optional[float]:
    if isinstance(v, (int, float)) and v > 0:
        return float(v)
    return None


def _add(catalog: list[CatalogEntry], price: Any, label: str) -> None:
    p = _safe_float(price)
    if p is not None:
        catalog.append((p, label))


def collect_digest_level_catalog(digest: dict[str, Any]) -> list[CatalogEntry]:
    catalog: list[CatalogEntry] = []

    kl = digest.get("key_levels") or {}
    _add(catalog, kl.get("prior_day_high"), "Prior day high")
    _add(catalog, kl.get("prior_day_low"), "Prior day low")
    _add(catalog, kl.get("recent_swing_high"), "Recent swing high")
    _add(catalog, kl.get("recent_swing_low"), "Recent swing low")

    fw = kl.get("fifty_two_week") or {}
    _add(catalog, fw.get("high_from_quote_daily"), "52-week high")
    _add(catalog, fw.get("low_from_last_252_sessions"), "52-week low")

    recent = digest.get("recent_price_structure") or {}
    prior = recent.get("prior_day") or {}
    _add(catalog, prior.get("open"), "Prior day open")
    _add(catalog, prior.get("high"), "Prior day high")
    _add(catalog, prior.get("low"), "Prior day low")
    _add(catalog, prior.get("close"), "Prior day close")
    _add(catalog, recent.get("high_last_5_sessions"), "High of last 5 sessions")
    _add(catalog, recent.get("low_last_5_sessions"), "Low of last 5 sessions")
    _add(catalog, recent.get("high_last_20_sessions"), "High of last 20 sessions")
    _add(catalog, recent.get("low_last_20_sessions"), "Low of last 20 sessions")

    multi = digest.get("multi_timescale_ranges") or {}
    for key, sessions_key, tight_label in (
        ("short", "short_sessions", True),
        ("intermediate", "intermediate_sessions", False),
        ("longer", "longer_sessions", False),
        ("long_base", "long_base_sessions", False),
    ):
        window = multi.get(key) or {}
        sessions = multi.get(sessions_key)
        hi = window.get("high")
        lo = window.get("low")
        tightness = window.get("tightness_range_vs_atr")
        is_tight = isinstance(tightness, (int, float)) and tightness <= 1.5
        if tight_label and is_tight and key == "short":
            _add(catalog, hi, "Top of consolidation area")
            _add(catalog, lo, "Bottom of consolidation area")
        else:
            _add(catalog, hi, f"{sessions}-session range high" if sessions else "Range high")
            _add(catalog, lo, f"{sessions}-session range low" if sessions else "Range low")

    mt_pairs = kl.get("multi_timescale_highs_lows") or {}
    for key, sessions in (
        ("short", multi.get("short_sessions")),
        ("intermediate", multi.get("intermediate_sessions")),
        ("longer", multi.get("longer_sessions")),
        ("long_base", multi.get("long_base_sessions")),
    ):
        pair = mt_pairs.get(key) or {}
        _add(catalog, pair.get("high"), f"{sessions}-session range high" if sessions else "Range high")
        _add(catalog, pair.get("low"), f"{sessions}-session range low" if sessions else "Range low")

    round_nums = kl.get("round_numbers_near_last_close") or {}
    _add(catalog, round_nums.get("below"), "Round number below")
    _add(catalog, round_nums.get("above"), "Round number above")

    ma_levels = kl.get("moving_average_levels") or {}
    for side_key, prefix in (
        ("nearest_moving_average_above", "Nearest MA above"),
        ("nearest_moving_average_below", "Nearest MA below"),
    ):
        side = ma_levels.get(side_key) or {}
        ema_key = side.get("key")
        ema_label = _EMA_LABELS.get(str(ema_key), str(ema_key).replace("_", " ").title() if ema_key else side_key)
        _add(catalog, side.get("value"), ema_label)

    vs_ma = (digest.get("trend_and_momentum") or {}).get("vs_moving_averages") or {}
    for ema_key, label in _EMA_LABELS.items():
        _add(catalog, vs_ma.get(ema_key), label)

    pm = digest.get("premarket") or {}
    if isinstance(pm, dict):
        _add(catalog, pm.get("last_price"), "Pre-market last price")
        _add(catalog, pm.get("high"), "Pre-market high")
        _add(catalog, pm.get("low"), "Pre-market low")

    return catalog


def match_price_to_digest_source(price: float, catalog: list[CatalogEntry]) -> Optional[str]:
    if not catalog or not isinstance(price, (int, float)) or price <= 0:
        return None
    tol = price_match_tolerance(float(price))
    best_label: Optional[str] = None
    best_delta: Optional[float] = None
    for catalog_price, label in catalog:
        delta = abs(catalog_price - float(price))
        if delta <= tol and (best_delta is None or delta < best_delta):
            best_label = label
            best_delta = delta
    return best_label


def is_generic_source(source: str) -> bool:
    return source.strip().lower() in _GENERIC_SOURCES


def enrich_level_source(level: dict[str, Any], digest: Optional[dict[str, Any]]) -> dict[str, Any]:
    source = str(level.get("source") or "").strip()
    if source and not is_generic_source(source):
        return level
    if not digest:
        return level
    price = level.get("price")
    if not isinstance(price, (int, float)):
        return level
    catalog = collect_digest_level_catalog(digest)
    matched = match_price_to_digest_source(float(price), catalog)
    if matched:
        out = dict(level)
        out["source"] = matched
        return out
    return level
