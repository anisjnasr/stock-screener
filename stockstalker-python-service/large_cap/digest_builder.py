"""
Build the Large Cap JSON digest from SQLite screener data (blueprint Section 7).

- All numbers are computed here; Claude only interprets downstream.
- Historical analogue engine: `large_cap/historical_analogues.py` (blueprint §7b-i).
- Pre-market: Massive full-market snapshot mapped in TS (`parseSnapshotTickerRow`); Python merges optional `premarket_snapshot`.
"""

from __future__ import annotations

import json
import math
import os
import sqlite3
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Literal, Optional
from zoneinfo import ZoneInfo

DataMode = Literal["historical", "historical_premarket"]

ET = ZoneInfo("America/New_York")

# Multi-timescale window lengths (sessions ending at prior completed day)
WINDOW_SHORT = 4
WINDOW_INTERMEDIATE = 15
WINDOW_LONGER = 55
WINDOW_LONG_BASE = 180

# Interest thresholds (transparent for tuning)
PROXIMITY_TO_PDH_PDL_PCT = 0.004  # 0.4% of price
SWING_LOOKBACK_SESSIONS = 20
ROUND_NUMBER_GRID = 5.0  # $5 steps near price; optional §7b

# Premarket vs historical divergence cue (blueprint §7b)
TIGHT_SHORT_WINDOW_ATR_RATIO = 1.5
LOW_PM_VOL_FRAC_OF_BASELINE = 0.05
GAP_SMALL_ABS_PCT = 0.08


def _repo_root() -> Path:
    """stockstalker-python-service/ is one level below repo root."""
    return Path(__file__).resolve().parent.parent.parent


def screener_db_path() -> Path:
    raw = (os.environ.get("SCREENER_DB_PATH") or "").strip()
    if raw:
        return Path(raw)
    return _repo_root() / "data" / "screener.db"


def default_analysis_date_ymd() -> str:
    return datetime.now(ET).strftime("%Y-%m-%d")


def _r4(x: Optional[float]) -> Optional[float]:
    if x is None:
        return None
    if isinstance(x, (int, float)) and (math.isnan(x) or math.isinf(x)):
        return None
    return round(float(x), 4)


def _r2(x: Optional[float]) -> Optional[float]:
    if x is None:
        return None
    if isinstance(x, (int, float)) and (math.isnan(x) or math.isinf(x)):
        return None
    return round(float(x), 2)


def true_range(high: float, low: float, prev_close: float) -> float:
    return max(high - low, abs(high - prev_close), abs(low - prev_close))


@dataclass
class Bar:
    date: str
    open: Optional[float]
    high: Optional[float]
    low: Optional[float]
    close: Optional[float]
    volume: Optional[int]


def _fetch_company(conn: sqlite3.Connection, symbol: str) -> tuple[Optional[str], Optional[str]]:
    row = conn.execute("SELECT symbol, name FROM companies WHERE symbol = ?", (symbol,)).fetchone()
    if not row:
        return None, None
    return row[0], row[1]


def _fetch_bars_before(conn: sqlite3.Connection, symbol: str, as_of: str) -> list[Bar]:
    cur = conn.execute(
        """
        SELECT date, open, high, low, close, volume
        FROM daily_bars
        WHERE symbol = ? AND date < ?
        ORDER BY date ASC
        """,
        (symbol, as_of),
    )
    out: list[Bar] = []
    for d, o, h, l, c, v in cur.fetchall():
        out.append(
            Bar(
                date=str(d),
                open=float(o) if o is not None else None,
                high=float(h) if h is not None else None,
                low=float(l) if l is not None else None,
                close=float(c) if c is not None else None,
                volume=int(v) if v is not None else None,
            )
        )
    return out


def _fetch_indicators_row(conn: sqlite3.Connection, symbol: str, bar_date: str) -> dict[str, Any]:
    row = conn.execute(
        """
        SELECT
          price_change_1w_pct, price_change_1m_pct, price_change_3m_pct,
          price_change_6m_pct, price_change_12m_pct,
          atr_14, atr_pct_14, atr_21, atr_pct_21,
          ema_20, ema_50, ema_100, ema_200,
          above_ema_20, pct_from_ema_20, above_ema_50, pct_from_ema_50,
          above_ema_100, pct_from_ema_100, above_ema_200, pct_from_ema_200,
          ema_20_above_50, ema_50_above_100, ema_50_above_200, ema_100_above_200
        FROM indicators_daily
        WHERE symbol = ? AND date = ?
        """,
        (symbol, bar_date),
    ).fetchone()
    if not row:
        return {}
    keys = [
        "price_change_1w_pct",
        "price_change_1m_pct",
        "price_change_3m_pct",
        "price_change_6m_pct",
        "price_change_12m_pct",
        "atr_14",
        "atr_pct_14",
        "atr_21",
        "atr_pct_21",
        "ema_20",
        "ema_50",
        "ema_100",
        "ema_200",
        "above_ema_20",
        "pct_from_ema_20",
        "above_ema_50",
        "pct_from_ema_50",
        "above_ema_100",
        "pct_from_ema_100",
        "above_ema_200",
        "pct_from_ema_200",
        "ema_20_above_50",
        "ema_50_above_100",
        "ema_50_above_200",
        "ema_100_above_200",
    ]
    return {k: row[i] for i, k in enumerate(keys)}


def _fetch_quote(conn: sqlite3.Connection, symbol: str, bar_date: str) -> dict[str, Any]:
    row = conn.execute(
        "SELECT high_52w, off_52w_high_pct, prev_close FROM quote_daily WHERE symbol = ? AND date = ?",
        (symbol, bar_date),
    ).fetchone()
    if not row:
        return {}
    return {"high_52w": row[0], "off_52w_high_pct": row[1], "prev_close": row[2]}


def _window_stats(
    bars: list[Bar],
    n: int,
    ref_price: float,
    atr_dollars: Optional[float],
) -> dict[str, Any]:
    """bars: last-N sessions of the series (caller slices), ending at prior day."""
    if not bars:
        return {
            "sessions_used": 0,
            "high": None,
            "low": None,
            "range_dollars": None,
            "range_pct_of_price": None,
            "tightness_range_vs_atr": None,
            "partial": True,
        }
    highs = [b.high for b in bars if b.high is not None]
    lows = [b.low for b in bars if b.low is not None]
    if not highs or not lows:
        return {
            "sessions_used": len(bars),
            "high": None,
            "low": None,
            "range_dollars": None,
            "range_pct_of_price": None,
            "tightness_range_vs_atr": None,
            "partial": True,
        }
    hi = max(highs)
    lo = min(lows)
    rng = hi - lo
    rng_pct = (rng / ref_price * 100) if ref_price else None
    tight = (rng / atr_dollars) if atr_dollars and atr_dollars > 0 else None
    return {
        "sessions_used": len(bars),
        "high": _r4(hi),
        "low": _r4(lo),
        "range_dollars": _r4(rng),
        "range_pct_of_price": _r4(rng_pct),
        "tightness_range_vs_atr": _r4(tight),
        "partial": len(bars) < n,
    }


def _trend_label(
    close: float,
    ema20: Optional[float],
    ema50: Optional[float],
    ema200: Optional[float],
) -> str:
    """Explicit rule: stacked MAs with price vs stack → trend; else sideways."""
    if ema20 is None or ema50 is None or ema200 is None:
        return "sideways"
    if close > ema20 > ema50 > ema200:
        return "uptrend"
    if close < ema20 < ema50 < ema200:
        return "downtrend"
    return "sideways"


def _nearest_round_levels(price: float, grid: float = ROUND_NUMBER_GRID) -> dict[str, Any]:
    """Round numbers within one grid step above/below (optional §7 key levels)."""
    if price <= 0:
        return {"below": None, "above": None, "grid_dollars": grid}
    below = math.floor(price / grid) * grid
    above = below + grid
    return {"below": _r2(below), "above": _r2(above), "grid_dollars": grid}


def _ma_magnet_levels(
    close: float,
    ema20: Optional[float],
    ema50: Optional[float],
    ema100: Optional[float],
    ema200: Optional[float],
) -> dict[str, Any]:
    ma = [("ema_20", ema20), ("ema_50", ema50), ("ema_100", ema100), ("ema_200", ema200)]
    above = [(n, v) for n, v in ma if v is not None and v > close]
    below = [(n, v) for n, v in ma if v is not None and v < close]
    nearest_above = min(above, key=lambda nv: nv[1]) if above else None
    nearest_below = max(below, key=lambda nv: nv[1]) if below else None
    return {
        "nearest_moving_average_above": {"key": nearest_above[0], "value": _r4(nearest_above[1])}
        if nearest_above
        else None,
        "nearest_moving_average_below": {"key": nearest_below[0], "value": _r4(nearest_below[1])}
        if nearest_below
        else None,
    }


def _safe_float(v: Any) -> Optional[float]:
    try:
        if v is None:
            return None
        x = float(v)
        if math.isnan(x) or math.isinf(x):
            return None
        return x
    except (TypeError, ValueError):
        return None


def _range_break_side(price: float, hi: Optional[float], lo: Optional[float]) -> Optional[dict[str, Any]]:
    if hi is None or lo is None or hi <= 0 or lo <= 0:
        return None
    if price > hi:
        return {"position": "above", "pct_beyond_edge": _r4((price - hi) / hi * 100)}
    if price < lo:
        return {"position": "below", "pct_beyond_edge": _r4((lo - price) / lo * 100)}
    return {"position": "inside", "pct_beyond_edge": None}


def apply_premarket_snapshot_to_digest(digest: dict[str, Any], snap: dict[str, Any]) -> None:
    """
    Mutates digest in place: fills `premarket` from snapshot row + derived vs digest levels.
    Gap % vs prior close uses DB prior session close so key levels stay internally consistent.
    """
    lp_raw = snap.get("last_price")
    pm_vol_raw = snap.get("pm_volume")
    baseline_raw = snap.get("avg_volume_baseline_shares")

    prior_close_db = _safe_float(digest.get("recent_price_structure", {}).get("prior_day", {}).get("close"))
    lp_f = _safe_float(lp_raw)

    if prior_close_db is None or lp_f is None or lp_f <= 0 or prior_close_db <= 0:
        digest["premarket"] = premarket_block_empty()
        return

    gap_pct_db = _r4((lp_f - prior_close_db) / prior_close_db * 100)

    pm_vol_n = _safe_float(pm_vol_raw)
    pm_vol_out: Optional[int] = int(pm_vol_n) if pm_vol_n is not None else None

    baseline_n = _safe_float(baseline_raw)
    if baseline_n is not None and baseline_n <= 0:
        baseline_n = None

    baseline_present = baseline_n is not None and baseline_n > 0
    can_compute_rvol = baseline_present and pm_vol_n is not None and baseline_n is not None
    rvol = (pm_vol_n / baseline_n) if can_compute_rvol else None

    pdh = _safe_float(digest.get("recent_price_structure", {}).get("prior_day_high"))
    pdl = _safe_float(digest.get("recent_price_structure", {}).get("prior_day_low"))

    notes: list[str] = []

    def add_note(level: Optional[float], label: str) -> None:
        if level is None or level <= 0:
            return
        pct = (lp_f - level) / level * 100
        notes.append(f"pre-market vs {label}: {_r4(pct)}%")

    add_note(pdh, "prior_day_high")
    add_note(pdl, "prior_day_low")

    kl = digest.get("key_levels") or {}
    add_note(_safe_float(kl.get("recent_swing_high")), "recent_swing_high")
    add_note(_safe_float(kl.get("recent_swing_low")), "recent_swing_low")

    mt_pairs = kl.get("multi_timescale_highs_lows") or {}
    for label in ("short", "intermediate", "long_base"):
        pair = mt_pairs.get(label) or {}
        add_note(_safe_float(pair.get("high")), f"{label}_window_high")
        add_note(_safe_float(pair.get("low")), f"{label}_window_low")

    mtr = digest.get("multi_timescale_ranges") or {}

    def win_rng(key: str) -> tuple[Optional[float], Optional[float]]:
        w = mtr.get(key) or {}
        return _safe_float(w.get("high")), _safe_float(w.get("low"))

    sh_hi, sh_lo = win_rng("short")
    rb_short = _range_break_side(lp_f, sh_hi, sh_lo)
    int_hi, int_lo = win_rng("intermediate")
    rb_int = _range_break_side(lp_f, int_hi, int_lo)
    lng_hi, lng_lo = win_rng("longer")
    rb_long = _range_break_side(lp_f, lng_hi, lng_lo)
    base_hi, base_lo = win_rng("long_base")
    rb_base = _range_break_side(lp_f, base_hi, base_lo)

    short_win = mtr.get("short") or {}
    tight_short = False
    thr = _safe_float(short_win.get("tightness_range_vs_atr"))
    if thr is not None and thr < TIGHT_SHORT_WINDOW_ATR_RATIO:
        tight_short = True

    broke_short = rb_short is not None and rb_short.get("position") in ("above", "below")

    gap_small = gap_pct_db is not None and abs(float(gap_pct_db)) < GAP_SMALL_ABS_PCT

    quiet_pm = False
    if baseline_n is not None and baseline_n > 0 and pm_vol_n is not None:
        quiet_pm = pm_vol_n < baseline_n * LOW_PM_VOL_FRAC_OF_BASELINE

    trend = digest.get("trend_and_momentum", {}).get("trend_label")

    picture = False
    if tight_short and broke_short:
        picture = True
    if trend in ("uptrend", "downtrend") and gap_small and quiet_pm:
        picture = True

    digest["premarket"] = {
        "last_price": _r4(lp_f),
        "gap_pct_vs_prior_close": gap_pct_db,
        "volume": pm_vol_out,
        "relative_volume_vs_baseline": _r4(rvol),
        "relative_volume_baseline_available": baseline_present,
        "distance_notes_vs_key_levels": notes,
        "range_break_vs_windows": {
            "short": rb_short,
            "intermediate": rb_int,
            "longer": rb_long,
            "long_base": rb_base,
        },
        "premarket_changes_picture": picture,
    }

    interest = digest.setdefault("interest_signals", {})
    interest["gap_beyond_prior_day_high"] = pdh is not None and lp_f > pdh
    interest["gap_below_prior_day_low"] = pdl is not None and lp_f < pdl


def premarket_block_empty() -> dict[str, Any]:
    """Schema placeholder when snapshot missing or unusable."""
    return {
        "last_price": None,
        "gap_pct_vs_prior_close": None,
        "volume": None,
        "relative_volume_vs_baseline": None,
        "relative_volume_baseline_available": False,
        "distance_notes_vs_key_levels": None,
        "range_break_vs_windows": {
            "short": None,
            "intermediate": None,
            "longer": None,
            "long_base": None,
        },
        "premarket_changes_picture": None,
    }


def build_large_cap_digest(
    ticker: str,
    data_mode: DataMode,
    *,
    analysis_date: Optional[str] = None,
    as_of_ymd: Optional[str] = None,
    premarket_snapshot: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """
    Build a single-stock digest for Claude.

    :param ticker: US equity symbol (e.g. AAPL)
    :param data_mode: historical | historical_premarket
    :param analysis_date: trading session date this digest is **for** (US/Eastern calendar day).
        Defaults to today's date in America/New_York.
    :param as_of_ymd: alias override for analysis_date (if both set, analysis_date wins)
    :param premarket_snapshot: optional row from Massive full-market snapshot (mapped in TS).
    """
    sym = ticker.strip().upper()
    if not sym:
        raise ValueError("ticker is required")

    ad = (analysis_date or as_of_ymd or default_analysis_date_ymd()).strip()
    if len(ad) != 10 or ad[4] != "-" or ad[7] != "-":
        raise ValueError("analysis_date must be YYYY-MM-DD")

    db_path = screener_db_path()
    if not db_path.is_file():
        raise FileNotFoundError(f"Screener database not found: {db_path}")

    conn = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True)
    try:
        company_sym, company_name = _fetch_company(conn, sym)
        if not company_sym:
            raise ValueError(f"Unknown symbol in screener DB: {sym}")

        completed = _fetch_bars_before(conn, sym, ad)
        if len(completed) < 2:
            raise ValueError(f"Not enough history for {sym} before {ad} (need at least 2 sessions).")

        prior = completed[-1]
        before_prior = completed[-2]

        if prior.close is None or before_prior.close is None:
            raise ValueError(f"Missing close prices for {sym} around prior session.")

        prior_close = float(prior.close)
        prev_prev_close = float(before_prior.close)

        pct_day_vs_prev = ((prior_close - prev_prev_close) / prev_prev_close * 100) if prev_prev_close else None

        ind = _fetch_indicators_row(conn, sym, prior.date)
        quote = _fetch_quote(conn, sym, prior.date)

        atr_period_used = 21
        atr_dollars = float(ind["atr_21"]) if ind.get("atr_21") is not None else None
        atr_pct_of_price = float(ind["atr_pct_21"]) if ind.get("atr_pct_21") is not None else None

        # Prior session true range & vs ATR
        tr_dollars: Optional[float] = None
        tr_pct: Optional[float] = None
        tr_vs_atr_ratio: Optional[float] = None
        if prior.high is not None and prior.low is not None:
            tr_dollars = true_range(float(prior.high), float(prior.low), prev_prev_close)
            tr_pct = (tr_dollars / prior_close * 100) if prior_close else None
            if atr_dollars and atr_dollars > 0:
                tr_vs_atr_ratio = tr_dollars / atr_dollars

        # Rolling windows ending at prior.date (slice completed bars)
        def take_last(n: int) -> list[Bar]:
            return completed[-n:] if len(completed) >= n else completed[:]

        ref = prior_close
        w_short = _window_stats(take_last(WINDOW_SHORT), WINDOW_SHORT, ref, atr_dollars)
        w_int = _window_stats(take_last(WINDOW_INTERMEDIATE), WINDOW_INTERMEDIATE, ref, atr_dollars)
        w_long = _window_stats(take_last(WINDOW_LONGER), WINDOW_LONGER, ref, atr_dollars)
        w_base = _window_stats(take_last(WINDOW_LONG_BASE), WINDOW_LONG_BASE, ref, atr_dollars)

        # Last 5 / 20 session high-low range (explicit §7b)
        hi5 = max(b.high for b in take_last(5) if b.high is not None) if len(take_last(5)) else None
        lo5 = min(b.low for b in take_last(5) if b.low is not None) if len(take_last(5)) else None
        hi20 = max(b.high for b in take_last(20) if b.high is not None) if len(take_last(20)) else None
        lo20 = min(b.low for b in take_last(20) if b.low is not None) if len(take_last(20)) else None

        swing_slice = completed[-SWING_LOOKBACK_SESSIONS:] if len(completed) >= SWING_LOOKBACK_SESSIONS else completed
        sh = max(b.high for b in swing_slice if b.high is not None) if swing_slice else None
        sl = min(b.low for b in swing_slice if b.low is not None) if swing_slice else None

        # 52-week low from bars (quote has high_52w only)
        take_252 = completed[-252:] if len(completed) >= 252 else completed[:]
        low_52w = min(b.low for b in take_252 if b.low is not None) if take_252 else None

        ema20 = float(ind["ema_20"]) if ind.get("ema_20") is not None else None
        ema50 = float(ind["ema_50"]) if ind.get("ema_50") is not None else None
        ema100 = float(ind["ema_100"]) if ind.get("ema_100") is not None else None
        ema200 = float(ind["ema_200"]) if ind.get("ema_200") is not None else None

        trend = _trend_label(prior_close, ema20, ema50, ema200)

        prox_threshold = PROXIMITY_TO_PDH_PDL_PCT * 100
        pdh = float(prior.high) if prior.high is not None else None
        pdl = float(prior.low) if prior.low is not None else None

        def near_level(price: float, level: Optional[float]) -> bool:
            if level is None or level <= 0:
                return False
            return abs(price - level) / level <= PROXIMITY_TO_PDH_PDL_PCT

        near_high = near_level(prior_close, pdh) if pdh else False
        near_low = near_level(prior_close, pdl) if pdl else False

        digest: dict[str, Any] = {
            "digest_schema_version": 1,
            "identity": {
                "ticker": sym,
                "company_name": company_name,
                "analysis_date": ad,
                "data_mode": data_mode,
                "prior_session_date": prior.date,
                "latest_completed_session_date_in_digest": prior.date,
            },
            "recent_price_structure": {
                "prior_day": {
                    "date": prior.date,
                    "open": _r4(prior.open),
                    "high": _r4(prior.high),
                    "low": _r4(prior.low),
                    "close": _r4(prior.close),
                    "volume": prior.volume,
                },
                "prior_day_high": _r4(pdh),
                "prior_day_low": _r4(pdl),
                "high_last_5_sessions": _r4(hi5),
                "low_last_5_sessions": _r4(lo5),
                "high_last_20_sessions": _r4(hi20),
                "low_last_20_sessions": _r4(lo20),
                "last_close_vs_prior_session_close_pct": _r4(pct_day_vs_prev),
            },
            "volatility_and_range": {
                "atr_period_used": atr_period_used,
                "atr_dollars": _r4(atr_dollars),
                "atr_pct_of_price": _r4(atr_pct_of_price),
                "prior_session_true_range_dollars": _r4(tr_dollars),
                "prior_session_true_range_pct_of_price": _r4(tr_pct),
                "prior_session_tr_vs_atr_ratio": _r4(tr_vs_atr_ratio),
            },
            "multi_timescale_ranges": {
                "short_sessions": WINDOW_SHORT,
                "short": w_short,
                "intermediate_sessions": WINDOW_INTERMEDIATE,
                "intermediate": w_int,
                "longer_sessions": WINDOW_LONGER,
                "longer": w_long,
                "long_base_sessions": WINDOW_LONG_BASE,
                "long_base": w_base,
            },
            "trend_and_momentum": {
                "trend_label_rule": "stacked_ema20_ema50_ema200_vs_close_else_sideways",
                "trend_label": trend,
                "roc_like_changes_pct": {
                    "price_change_1w_pct": _r4(
                        float(ind["price_change_1w_pct"]) if ind.get("price_change_1w_pct") is not None else None
                    ),
                    "price_change_1m_pct": _r4(
                        float(ind["price_change_1m_pct"]) if ind.get("price_change_1m_pct") is not None else None
                    ),
                    "price_change_3m_pct": _r4(
                        float(ind["price_change_3m_pct"]) if ind.get("price_change_3m_pct") is not None else None
                    ),
                    "price_change_6m_pct": _r4(
                        float(ind["price_change_6m_pct"]) if ind.get("price_change_6m_pct") is not None else None
                    ),
                    "price_change_12m_pct": _r4(
                        float(ind["price_change_12m_pct"]) if ind.get("price_change_12m_pct") is not None else None
                    ),
                },
                "vs_moving_averages": {
                    "ema_20": _r4(ema20),
                    "ema_50": _r4(ema50),
                    "ema_100": _r4(ema100),
                    "ema_200": _r4(ema200),
                    "above_ema_20": bool(ind.get("above_ema_20")) if ind.get("above_ema_20") is not None else None,
                    "pct_from_ema_20": _r4(
                        float(ind["pct_from_ema_20"]) if ind.get("pct_from_ema_20") is not None else None
                    ),
                    "above_ema_50": bool(ind.get("above_ema_50")) if ind.get("above_ema_50") is not None else None,
                    "pct_from_ema_50": _r4(
                        float(ind["pct_from_ema_50"]) if ind.get("pct_from_ema_50") is not None else None
                    ),
                    "above_ema_100": bool(ind.get("above_ema_100")) if ind.get("above_ema_100") is not None else None,
                    "pct_from_ema_100": _r4(
                        float(ind["pct_from_ema_100"]) if ind.get("pct_from_ema_100") is not None else None
                    ),
                    "above_ema_200": bool(ind.get("above_ema_200")) if ind.get("above_ema_200") is not None else None,
                    "pct_from_ema_200": _r4(
                        float(ind["pct_from_ema_200"]) if ind.get("pct_from_ema_200") is not None else None
                    ),
                    "ema_20_above_ema_50": bool(ind["ema_20_above_50"]) if ind.get("ema_20_above_50") is not None else None,
                    "ema_50_above_ema_100": bool(ind["ema_50_above_100"]) if ind.get("ema_50_above_100") is not None else None,
                    "ema_50_above_ema_200": bool(ind["ema_50_above_200"]) if ind.get("ema_50_above_200") is not None else None,
                    "ema_100_above_ema_200": bool(ind["ema_100_above_200"])
                    if ind.get("ema_100_above_200") is not None
                    else None,
                },
            },
            "key_levels": {
                "prior_day_high": _r4(pdh),
                "prior_day_low": _r4(pdl),
                "multi_timescale_highs_lows": {
                    "short": {"high": w_short.get("high"), "low": w_short.get("low")},
                    "intermediate": {"high": w_int.get("high"), "low": w_int.get("low")},
                    "longer": {"high": w_long.get("high"), "low": w_long.get("low")},
                    "long_base": {"high": w_base.get("high"), "low": w_base.get("low")},
                },
                "swing_lookback_sessions": SWING_LOOKBACK_SESSIONS,
                "recent_swing_high": _r4(sh),
                "recent_swing_low": _r4(sl),
                "fifty_two_week": {
                    "high_from_quote_daily": _r4(float(quote["high_52w"]) if quote.get("high_52w") is not None else None),
                    "off_high_pct_from_quote": _r4(
                        float(quote["off_52w_high_pct"]) if quote.get("off_52w_high_pct") is not None else None
                    ),
                    "low_from_last_252_sessions": _r4(low_52w),
                },
                "round_numbers_near_last_close": _nearest_round_levels(prior_close),
                "moving_average_levels": _ma_magnet_levels(prior_close, ema20, ema50, ema100, ema200),
            },
            "interest_signals": {
                "proximity_threshold_pct_of_price_for_pdh_pdl": prox_threshold,
                "price_within_threshold_of_prior_day_high": near_high,
                "price_within_threshold_of_prior_day_low": near_low,
                "gap_beyond_prior_day_high": None,
                "gap_below_prior_day_low": None,
                "premarket_required_for_gap_flags": True,
                "prior_session_tr_vs_atr_ratio": _r4(tr_vs_atr_ratio),
                "yesterday_was_range_expansion_vs_atr": (tr_vs_atr_ratio is not None and tr_vs_atr_ratio > 1.0),
            },
        }

        if data_mode == "historical":
            digest["premarket"] = None
        else:
            digest["premarket"] = premarket_block_empty()
            if premarket_snapshot:
                apply_premarket_snapshot_to_digest(digest, dict(premarket_snapshot))

        from large_cap.historical_analogues import compute_historical_analogues_block

        digest["historical_analogues"] = compute_historical_analogues_block(conn, sym, completed, digest)

        return digest
    finally:
        conn.close()


def digest_to_pretty_json(digest: dict[str, Any]) -> str:
    return json.dumps(digest, indent=2, sort_keys=False)


def main_cli() -> None:
    import argparse
    import sys

    p = argparse.ArgumentParser(description="Build Large Cap digest JSON (stdout).")
    p.add_argument("ticker", help="Symbol, e.g. AAPL")
    p.add_argument(
        "data_mode",
        nargs="?",
        default="historical",
        choices=("historical", "historical_premarket"),
        help="Data mode (default historical)",
    )
    p.add_argument("--as-of", dest="as_of", default=None, help="Analysis session date YYYY-MM-DD (Eastern calendar)")
    p.add_argument("--db", dest="db", default=None, help="Override path to screener.db")
    p.add_argument(
        "--premarket-json",
        dest="premarket_json",
        default=None,
        help="Path to JSON object matching TS LargeCapPremarketQuotePayload (for historical_premarket testing)",
    )
    args = p.parse_args()
    if args.db:
        os.environ["SCREENER_DB_PATH"] = args.db

    pm_snap: Optional[dict[str, Any]] = None
    if args.premarket_json:
        try:
            raw = Path(args.premarket_json).read_text(encoding="utf-8-sig")
            pm_snap = json.loads(raw)
            if not isinstance(pm_snap, dict):
                raise ValueError("premarket JSON must be an object")
        except Exception as e:
            print(json.dumps({"ok": False, "error": f"--premarket-json: {e}"}), file=sys.stderr)
            sys.exit(1)

    try:
        d = build_large_cap_digest(
            args.ticker,
            args.data_mode,
            analysis_date=args.as_of,
            premarket_snapshot=pm_snap,
        )
        sys.stdout.write(digest_to_pretty_json(d) + "\n")
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main_cli()
