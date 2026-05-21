"""
Historical analogue engine — blueprint §7b-i.

Pure deterministic matching on each symbol's own OHLC + indicators (SQLite).
Summary statistics reflect the whole matched set; `examples` caps display count only.
"""

from __future__ import annotations

import logging
import sqlite3
from typing import Any, Literal, Optional

logger = logging.getLogger(__name__)

# --- Tunable documented constants (blueprint §7b-i) ---
EXCLUDE_LAST_SESSIONS = 10
"""Trailing sessions excluded so today's tape doesn't contaminate matches."""

LOW_SAMPLE_THRESHOLD = 3
"""When match_count < this, `low_sample` is True."""

MAX_EXAMPLES = 5
"""Examples trim only; summaries use every match."""

TIGHT_WINDOW_ATR_RATIO_MAX = 1.6
"""Short window counts as 'tight/coiled' when tightness_range_vs_atr <= this."""

ENGINE_RULE_VERSION = "v1"


Position = Literal["inside", "above", "below"]


def _safe_float(v: Any) -> Optional[float]:
    try:
        if v is None:
            return None
        x = float(v)
        import math

        if math.isnan(x) or math.isinf(x):
            return None
        return x
    except (TypeError, ValueError):
        return None


def classify_gap_bucket(gap_pct: Optional[float]) -> Optional[str]:
    """
    Overnight / pre-market gap size bucket (direction preserved).
    Thresholds are percentages (e.g. 2 means 2%).
    """
    if gap_pct is None:
        return None
    g = float(gap_pct)
    if abs(g) < 0.05:
        return "flat"
    if g >= 5.0:
        return "large_up"
    if g >= 2.0:
        return "moderate_up"
    if g > 0.05:
        return "small_up"
    if g <= -5.0:
        return "large_down"
    if g <= -2.0:
        return "moderate_down"
    return "small_down"


def format_gap_bucket_label(bucket: Optional[str]) -> str:
    labels = {
        "flat": "Flat gap",
        "small_up": "Small gap up",
        "moderate_up": "Moderate gap up",
        "large_up": "Large gap up",
        "small_down": "Small gap down",
        "moderate_down": "Moderate gap down",
        "large_down": "Large gap down",
    }
    return labels.get(bucket or "", bucket or "Unknown gap")


def format_setup_signature(trend: str, short_tight: bool, gap_bucket: Optional[str]) -> str:
    parts: list[str] = []
    if gap_bucket:
        parts.append(format_gap_bucket_label(gap_bucket))
    parts.append("Tight base" if short_tight else "Loose base")
    trend_labels = {"uptrend": "Uptrend", "downtrend": "Downtrend", "sideways": "Sideways"}
    parts.append(trend_labels.get(trend, trend))
    return " · ".join(parts)


def position_vs_range(ref_px: float, hi: Optional[float], lo: Optional[float]) -> Optional[Position]:
    if hi is None or lo is None or hi <= 0 or lo <= 0:
        return None
    if ref_px > hi:
        return "above"
    if ref_px < lo:
        return "below"
    return "inside"


def reference_price_from_digest(digest: dict[str, Any]) -> Optional[float]:
    """Anchor price for today's setup vs ranges (PM when usable, else prior close)."""
    dm = digest.get("identity", {}).get("data_mode")
    if dm == "historical_premarket":
        pm = digest.get("premarket") or {}
        lp = _safe_float(pm.get("last_price"))
        if lp is not None and lp > 0:
            return lp
    prior = digest.get("recent_price_structure", {}).get("prior_day", {}).get("close")
    return _safe_float(prior)


def digest_signature_for_today(digest: dict[str, Any]) -> Optional[tuple[str, bool, Position, Optional[str]]]:
    """
    Returns (trend_label, short_tight, short_position, gap_bucket_filter_or_None).
    gap_bucket_filter_or_None is None when gap dimension is omitted (historical-only / missing PM gap).
    """
    trend = digest.get("trend_and_momentum", {}).get("trend_label")
    if trend not in ("uptrend", "downtrend", "sideways"):
        return None

    short_win = digest.get("multi_timescale_ranges", {}).get("short") or {}
    tightness = _safe_float(short_win.get("tightness_range_vs_atr"))
    short_tight = tightness is not None and tightness <= TIGHT_WINDOW_ATR_RATIO_MAX

    hi = _safe_float(short_win.get("high"))
    lo = _safe_float(short_win.get("low"))
    ref = reference_price_from_digest(digest)
    if ref is None or ref <= 0:
        return None
    pos = position_vs_range(ref, hi, lo)
    if pos is None:
        return None

    gap_filter: Optional[str] = None
    dm = digest.get("identity", {}).get("data_mode")
    if dm == "historical_premarket":
        pm = digest.get("premarket") or {}
        gp = _safe_float(pm.get("gap_pct_vs_prior_close"))
        if gp is not None:
            gap_filter = classify_gap_bucket(gp)

    return (str(trend), short_tight, pos, gap_filter)


def _filter_bars_strictly_before(bars: list[Any], before_date: str) -> list[Any]:
    """In-memory data-layer cutoff (tests / pre-fetched inputs). Dates must be YYYY-MM-DD."""
    return [b for b in bars if str(b.date) < before_date]


def _fetch_indicators_sparse(conn: sqlite3.Connection, symbol: str, before_date: str) -> dict[str, dict[str, Any]]:
    """date -> indicator row subset needed for trend + ATR windows."""
    cur = conn.execute(
        """
        SELECT date, atr_21,
               ema_20, ema_50, ema_200
        FROM indicators_daily
        WHERE symbol = ? AND date < ?
        ORDER BY date ASC
        """,
        (symbol, before_date),
    )
    out: dict[str, dict[str, Any]] = {}
    for row in cur.fetchall():
        d = str(row[0])
        out[d] = {"atr_21": row[1], "ema_20": row[2], "ema_50": row[3], "ema_200": row[4]}
    return out


def classify_follow_through(close_anchor: float, open_next: float, close_next: float, gap_pct: float) -> str:
    """Deterministic next-session behaviour tag vs overnight gap."""
    if open_next <= 0:
        return "neutral_chop"
    intraday_signed = (close_next - open_next) / open_next * 100
    if abs(gap_pct) < 0.08:
        return "neutral_chop"
    if gap_pct > 0:
        if intraday_signed > 0.03:
            return "follow_through"
        if intraday_signed < -0.03:
            return "reversed"
        return "neutral_chop"
    if gap_pct < 0:
        if intraday_signed < -0.03:
            return "follow_through"
        if intraday_signed > 0.03:
            return "reversed"
        return "neutral_chop"
    return "neutral_chop"


def compute_historical_analogues_block(
    conn: sqlite3.Connection | None,
    symbol: str,
    completed_bars: list[Any],
    digest: dict[str, Any],
    *,
    indicators_by_date: dict[str, dict[str, Any]] | None = None,
    lab_mode_reference_date: Optional[str] = None,
) -> dict[str, Any]:
    """
    Build `historical_analogues` block after the rest of `digest` is assembled (including pre-market).

    When `lab_mode_reference_date` is set (Comp Lab), comp search uses only OHLC and indicators
    strictly before that date — enforced at fetch/filter time, not by post-filtering matches.

    Lazy-imports digest_builder window helpers so module load order stays acyclic.
    """
    from large_cap.digest_builder import (
        WINDOW_SHORT,
        Bar,
        _fetch_bars_before,
        _trend_label,
        _window_stats,
    )

    analysis_date = digest.get("identity", {}).get("analysis_date")
    prior_session = digest.get("recent_price_structure", {}).get("prior_day", {}).get("date")
    if not analysis_date or not prior_session:
        return _empty_block(reason="missing_identity_dates")

    today_sig = digest_signature_for_today(digest)
    if today_sig is None:
        return _empty_block(reason="today_signature_incomplete")

    trend_want, short_tight_want, short_pos_want, gap_filter = today_sig

    lab_ref = lab_mode_reference_date.strip() if isinstance(lab_mode_reference_date, str) else None
    if lab_ref == "":
        lab_ref = None

    if lab_ref is not None:
        logger.info(
            "comp_engine lab_mode_reference_date=%s symbol=%s analysis_date=%s",
            lab_ref,
            symbol,
            analysis_date,
        )
        if conn is not None:
            bars: list[Bar] = _fetch_bars_before(conn, symbol, lab_ref)  # type: ignore[assignment]
            ind_by_date = _fetch_indicators_sparse(conn, symbol, lab_ref)
        else:
            bars = _filter_bars_strictly_before(completed_bars, lab_ref)  # type: ignore[assignment]
            if indicators_by_date is not None:
                ind_by_date = {d: row for d, row in indicators_by_date.items() if d < lab_ref}
            else:
                return _empty_block(reason="lab_mode_missing_indicators")
    else:
        bars = completed_bars  # type: ignore[assignment]
        if indicators_by_date is not None:
            ind_by_date = indicators_by_date
        elif conn is not None:
            ind_by_date = _fetch_indicators_sparse(conn, symbol, analysis_date)
        else:
            return _empty_block(reason="missing_indicators")

    if len(bars) < WINDOW_SHORT + EXCLUDE_LAST_SESSIONS + 3:
        return _empty_block(reason="insufficient_history")

    prior_idx = len(bars) - 1
    max_anchor_idx = prior_idx - EXCLUDE_LAST_SESSIONS
    if max_anchor_idx < 0:
        return _empty_block(reason="insufficient_history_after_exclusion_window")

    matches: list[dict[str, Any]] = []

    for i in range(0, max_anchor_idx + 1):
        if i + 1 >= len(bars):
            break
        b = bars[i]
        nxt = bars[i + 1]
        if lab_ref is not None and (b.date >= lab_ref or nxt.date >= lab_ref):
            continue
        if b.close is None or b.high is None or b.low is None:
            continue
        if nxt.open is None or nxt.high is None or nxt.low is None or nxt.close is None:
            continue

        close_anchor = float(b.close)
        open_next = float(nxt.open)
        high_next = float(nxt.high)
        low_next = float(nxt.low)
        close_next = float(nxt.close)

        ind_row = ind_by_date.get(b.date)
        if not ind_row:
            continue
        atr = _safe_float(ind_row.get("atr_21"))
        if atr is None or atr <= 0:
            continue

        prefix = bars[: i + 1]
        win_slice = prefix[-WINDOW_SHORT:] if len(prefix) >= WINDOW_SHORT else prefix[:]
        wshort = _window_stats(win_slice, WINDOW_SHORT, close_anchor, atr)
        hi_s = _safe_float(wshort.get("high"))
        lo_s = _safe_float(wshort.get("low"))
        thr_s = _safe_float(wshort.get("tightness_range_vs_atr"))
        if hi_s is None or lo_s is None or thr_s is None:
            continue

        cand_short_tight = thr_s <= TIGHT_WINDOW_ATR_RATIO_MAX
        cand_pos = position_vs_range(close_anchor, hi_s, lo_s)
        if cand_pos is None:
            continue

        ema20 = _safe_float(ind_row.get("ema_20"))
        ema50 = _safe_float(ind_row.get("ema_50"))
        ema200 = _safe_float(ind_row.get("ema_200"))
        cand_trend = _trend_label(close_anchor, ema20, ema50, ema200)

        overnight_gap_pct = ((open_next - close_anchor) / close_anchor * 100) if close_anchor > 0 else 0.0
        cand_gap_bucket = classify_gap_bucket(overnight_gap_pct)

        if cand_trend != trend_want:
            continue
        if cand_short_tight != short_tight_want:
            continue
        if cand_pos != short_pos_want:
            continue
        if gap_filter is not None:
            if cand_gap_bucket != gap_filter:
                continue

        gap_pct_for_label = overnight_gap_pct
        ft_label = classify_follow_through(close_anchor, open_next, close_next, gap_pct_for_label)

        rng_pct = ((high_next - low_next) / open_next * 100) if open_next > 0 else None
        body_pct = ((close_next - open_next) / open_next * 100) if open_next > 0 else None

        matches.append(
            {
                "_sort_date": b.date,
                "analogue_session_date": b.date,
                "next_session_date": nxt.date,
                "overnight_gap_pct_into_next_session": round(overnight_gap_pct, 4),
                "gap_bucket_used_for_match": cand_gap_bucket,
                "setup_signature": format_setup_signature(cand_trend, cand_short_tight, cand_gap_bucket),
                "similarity_score": 100,
                "next_session": {
                    "open": round(open_next, 4),
                    "high": round(high_next, 4),
                    "low": round(low_next, 4),
                    "close": round(close_next, 4),
                    "true_range_pct_of_open": round(rng_pct, 4) if rng_pct is not None else None,
                    "close_vs_open_pct": round(body_pct, 4) if body_pct is not None else None,
                    "follow_through_label": ft_label,
                },
            }
        )

    match_count = len(matches)

    follow_through_count = sum(1 for m in matches if m["next_session"]["follow_through_label"] == "follow_through")
    reversed_count = sum(1 for m in matches if m["next_session"]["follow_through_label"] == "reversed")
    flat_or_chop_count = sum(1 for m in matches if m["next_session"]["follow_through_label"] == "neutral_chop")

    moves_abs = []
    ranges = []
    for m in matches:
        bp = m["next_session"].get("close_vs_open_pct")
        if bp is not None:
            moves_abs.append(abs(float(bp)))
        tr = m["next_session"].get("true_range_pct_of_open")
        if tr is not None:
            ranges.append(float(tr))

    def avg(xs: list[float]) -> Optional[float]:
        return round(sum(xs) / len(xs), 4) if xs else None

    analogue_dates = [m["analogue_session_date"] for m in matches]

    examples_raw = sorted(matches, key=lambda m: m["_sort_date"], reverse=True)[:MAX_EXAMPLES]
    examples = []
    for ex in examples_raw:
        d = {k: v for k, v in ex.items() if k != "_sort_date"}
        examples.append(d)

    result: dict[str, Any] = {
        "engine_rule_version": ENGINE_RULE_VERSION,
        "matching_rule_summary": (
            "Require same trend_label, short-window tightness class (vs ATR), short-window range position "
            "(inside/above/below), and — only when today's digest includes pre-market gap — same gap bucket "
            "as overnight gap from analogue close into next open. Candidates exclude the last "
            f"{EXCLUDE_LAST_SESSIONS} completed sessions."
        ),
        "engine_constants": {
            "exclude_last_sessions": EXCLUDE_LAST_SESSIONS,
            "low_sample_threshold": LOW_SAMPLE_THRESHOLD,
            "max_examples_trim": MAX_EXAMPLES,
            "tight_short_window_max_tightness_vs_atr": TIGHT_WINDOW_ATR_RATIO_MAX,
        },
        "match_count": match_count,
        "low_sample": match_count < LOW_SAMPLE_THRESHOLD,
        "lookback_span": {
            "scan_earliest_session": bars[0].date,
            "scan_latest_eligible_anchor_session": bars[max_anchor_idx].date if max_anchor_idx >= 0 else None,
            "prior_session_for_digest": prior_session,
            "oldest_analogue_session": min(analogue_dates) if analogue_dates else None,
            "newest_analogue_session": max(analogue_dates) if analogue_dates else None,
        },
        "summary_tendencies": {
            "follow_through_count": follow_through_count,
            "reversed_count": reversed_count,
            "flat_or_chop_count": flat_or_chop_count,
            "avg_next_day_abs_close_vs_open_pct": avg(moves_abs),
            "avg_next_day_true_range_pct_of_open": avg(ranges),
            "next_day_abs_close_vs_open_pct_min": round(min(moves_abs), 4) if moves_abs else None,
            "next_day_abs_close_vs_open_pct_max": round(max(moves_abs), 4) if moves_abs else None,
        },
        "examples": examples,
    }
    if lab_ref is not None:
        result["lab_mode_reference_date"] = lab_ref
        lab_matches = []
        for m in sorted(matches, key=lambda x: x["_sort_date"], reverse=True):
            lab_matches.append({k: v for k, v in m.items() if k != "_sort_date"})
        result["matches"] = lab_matches
        trend_want, short_tight_want, _, gap_filter = today_sig
        result["reference_setup_signature"] = format_setup_signature(trend_want, short_tight_want, gap_filter)
    return result


def _empty_block(reason: str) -> dict[str, Any]:
    return {
        "engine_rule_version": ENGINE_RULE_VERSION,
        "matching_rule_summary": (
            "Require same trend_label, short-window tightness class (vs ATR), short-window range position "
            "(inside/above/below), optional gap-bucket filter from pre-market. See `engine_constants`."
        ),
        "engine_constants": {
            "exclude_last_sessions": EXCLUDE_LAST_SESSIONS,
            "low_sample_threshold": LOW_SAMPLE_THRESHOLD,
            "max_examples_trim": MAX_EXAMPLES,
            "tight_short_window_max_tightness_vs_atr": TIGHT_WINDOW_ATR_RATIO_MAX,
        },
        "match_count": 0,
        "low_sample": True,
        "lookback_span": None,
        "empty_reason": reason,
        "summary_tendencies": {
            "follow_through_count": 0,
            "reversed_count": 0,
            "flat_or_chop_count": 0,
            "avg_next_day_abs_close_vs_open_pct": None,
            "avg_next_day_true_range_pct_of_open": None,
            "next_day_abs_close_vs_open_pct_min": None,
            "next_day_abs_close_vs_open_pct_max": None,
        },
        "examples": [],
    }
