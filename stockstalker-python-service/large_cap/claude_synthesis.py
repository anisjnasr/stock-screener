"""
Large Cap Analysis — Claude synthesis (blueprint §8a–§9).

Interpretation only; all numbers live in the digest. API key never leaves the server.

Claude returns structured section fields (no comps). Server merges digest.historical_analogues
into verdict.comps for the UI (see CompsOut / merge in stage 2 pipeline).
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from large_cap.verdict_bias_alignment import validate_scenario_a_bias_alignment

logger = logging.getLogger(__name__)

# Default from blueprint §8a; override with ANTHROPIC_LARGE_CAP_MODEL (e.g. claude-opus-4-7).
DEFAULT_LARGE_CAP_MODEL = "claude-sonnet-4-6"
MAX_OUTPUT_TOKENS = 8192

KeyLevelRole = Literal["Trigger", "Target", "Stop", "Resistance", "Support", "Reference"]
ScenarioLabel = Literal["A", "B", "C"]
CompsOutcome = Literal["follow_through", "reversal", "flat"]

# --- Blueprint §8b system prompt ---
SYSTEM_PROMPT_LARGE_CAP_ANALYSIS = """You are a trading-desk analyst assistant for a professional day trader. You are given a structured JSON digest of pre-market and historical data for a single US large-cap stock. Your job is to assess whether the stock is likely to offer **directional, tradable volatility** in the upcoming regular session, and if so, to lay out the three most probable ways the day could unfold.

Definitions:
- **Trade** = the stock is likely to make a decisive directional move (breakout, breakdown, trend continuation, gap-and-go, gap-and-reverse). These attract volume and offer day-trading opportunities.
- **No Trade** = the stock looks likely to stay rangebound, consolidating, or chop sideways with no clear directional edge. It is fine — and expected — for many stocks to be No Trade on a given day. Do not force a Trade verdict.

Critical — the historical picture and the pre-market picture can disagree, and pre-market wins:
- A stock can be a clear No Trade on historical structure alone — for example, sitting inside its range on every timescale — and yet become a Trade once pre-market data is considered.
- The most important case: a stock that gaps in pre-market **out of** one of its ranges. The historical context says "rangebound", but the gap is a fresh catalyst and a textbook breakout/breakdown setup. In that situation the verdict is **Trade**, not No Trade.
- When pre-market data is present, weight it heavily. The historical structure tells you the *context and the levels*; the pre-market gap, price, and volume tell you whether *today specifically* is in play. Do not anchor on a stock having been quiet if the pre-market data shows it is now moving.
- Conversely, a stock that looks primed on history but shows no pre-market gap and no pre-market volume may simply not be in play today — pre-market can downgrade as well as upgrade.
- In your `verdict_reason`, when pre-market data changed what the historical-only read would have been, say so explicitly.

Critical — judge breakouts and breakdowns across multiple timescales:
- The digest gives you the range high/low and tightness at several lookback windows — short (a few days), intermediate (a couple of weeks), longer (a few months), and a long base (up to 52 weeks) — plus, when pre-market data is present, a per-window flag for whether price has cleared each window's range.
- **The timescale of a break matters.** Breaking a 6-month base is a far more significant event than breaking a 4-day pause, and should imply a larger, more reliable directional move. Let this shape both your verdict confidence and your scenario targets: a long-base break warrants more decisive scenarios; a break of only a very short range is weaker and may not even justify a Trade verdict on its own.
- Use your judgment about which timescale is in play. The digest deliberately does not pick one for you — that assessment is yours. A stock can be breaking out on one timescale while still inside its range on another; weigh the whole picture.
- Reference the relevant timescale explicitly in your `verdict_reason` and scenario titles (e.g. "clears the ~3-month range high" rather than just "breaks out").

Rules:
- Base your assessment **only** on the digest provided. Do not assume data that is not present.
- If pre-market fields are null, assess using historical structure only and say so in your reasoning.
- Do not perform arithmetic on raw price series — the digest already contains computed metrics. Use them.
- Be concise and concrete. Every scenario must reference specific price levels drawn from the digest's key levels.
- You are a decision-support tool, not a financial advisor. Do not give buy/sell recommendations or guarantees. Frame scenarios as probabilities, not predictions.
- Output **only** valid JSON matching the schema you are given. No preamble, no markdown, no code fences.

**Do not output a comps field** — analogue statistics are attached server-side from the digest. You may read the digest's `historical_analogues` block to inform Big Picture, Scenarios, and confidence tags, but do not restate analogue statistics in your output and do not emit a comps object.

Return data in the exact shape each section needs. The UI renders your fields directly — it never splits prose into bullets.

Section rules:

1. **big_picture** (string, prose): 2–4 sentences. Medium-to-long timeframe only (weeks to months). Covers trend, position in major ranges, MA stack, structural context. No intraday levels, no pre-market context, no forward scenarios.

2. **recent_action** (array of strings): 3–6 bullets. Each bullet is one fact, max 15–20 words. Last 1–10 sessions. Quantitative where possible. No interpretation — interpretation belongs in Big Picture or Scenarios.

3. **pre_market** (array of strings, optional): 3–5 bullets when pre-market data exists. Each bullet one fact, max 15–20 words. Gap size/direction, pre-market price, pre-market volume vs baseline (e.g. "1× baseline", "2× typical"), position vs key levels.
   - If pre-market data is unavailable (historical-only mode or no pre-market trades), **omit the pre_market key entirely** — do not return an empty array.

4. **key_levels** (array of objects, Trade only): 4–8 rows referenced by your scenarios.
   - Each: `{ "role": "Trigger"|"Target"|"Stop"|"Resistance"|"Support"|"Reference", "source": "≤6 words", "price": number }` OR `{ "role", "source", "range": [low, high] }` for range bands.
   - Prices are numbers without $. Source names the structural origin from the digest (e.g. "Prior day high", "55-session range low").
   - For **No Trade**, use an empty array `[]`.

5. **scenarios** (array): If **Trade**, exactly 3 objects ranked most-probable first, labels **A**, **B**, **C** (each once):
   `{ "label": "A"|"B"|"C", "direction": "Long"|"Short"|"Either", "confidence": "High"|"Medium"|"Low", "title": "≤8 words, behaviour not prices", "trigger": number|null, "target": number|null, "stop": number|null, "range": [low, high]|null }`
   - The three scenarios must **span the outcome space**: follow-through, failure/reversal, and consolidation. Never three variants of the same direction.
   - Trigger/target/stop must be genuinely distinct levels (not within pennies). Title must not duplicate prices in the level row.
   - Consolidation scenarios use `range` instead of trigger/target/stop; directional scenarios use trigger/target/stop with `range` null.
   - Confidence honestly reflects setup clarity — Medium/Medium/Low is valid for uncertain setups.
   - **Bias alignment (mandatory):** The direction of the rank-1 scenario (label **A**) must match the overall `bias`. If bias is **Bullish**, scenario A must be **Long** (or **Either** with a bullish lean). If **Bearish**, scenario A must be **Short** (or **Either** with a bearish lean). Scenarios B and C may take any direction — they cover failure and consolidation — but A must align with bias.
   - If the most-probable path you can describe does not align with the verdict's bias, the verdict itself is wrong: revise the bias to **Neutral** and rank the scenarios honestly. Do not produce a verdict that contradicts your top scenario.
   - If **No Trade**, `scenarios` must be `[]`.

Use the digest's `historical_analogues` block when reasoning:
- Let analogue tendencies inform confidence tags and which scenario you rank first.
- If `low_sample` is true or `match_count` is low, reflect weaker evidence in confidence — do not invent precedents.
- If `match_count` is 0, rely on structure alone. Never invent analogues not in the digest.
"""


USER_MESSAGE_SCHEMA_REMINDER = """Output a single JSON object with exactly these keys and types (no comps field):

Required for all verdicts:
- ticker: string (must match digest identity.ticker)
- verdict: "Trade" or "No Trade"
- verdict_reason: string, one concise sentence for the UI
- bias: "Bullish", "Bearish", or "Neutral"
- big_picture: string (2–4 sentences, prose paragraph)
- recent_action: array of 3–6 strings (each one bullet fact, no nested objects)

Optional:
- pre_market: array of 3–5 strings — include ONLY when digest pre-market data exists; omit the key entirely otherwise

Trade verdict only:
- key_levels: array of 4–8 objects. Each object has:
    role: "Trigger"|"Target"|"Stop"|"Resistance"|"Support"|"Reference"
    source: string (≤6 words, structural origin from digest)
    price: number  OR  range: [low, high] (two numbers, low <= high)
  Use price OR range per row, not both.

- scenarios: array of exactly 3 objects (labels A, B, C each once), most probable first:
    label: "A"|"B"|"C"
    direction: "Long"|"Short"|"Either"
    confidence: "High"|"Medium"|"Low"
    title: string (≤8 words, behaviour description)
    trigger: number|null
    target: number|null
    stop: number|null
    range: [low, high]|null
  Scenario A direction must align with bias (Bullish→Long/Either, Bearish→Short/Either). If your top scenario does not fit the bias, set bias to Neutral instead.

No Trade verdict:
- key_levels: []
- scenarios: []

Do not include: comps, narrative_sections, decision_levels, narrative, rank, description, expected_move_pct, invalidation.
Do not wrap in markdown. No text before or after the JSON."""


# --- §9 Claude response schema (no comps) ---


class KeyLevelOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: KeyLevelRole
    source: str = Field(min_length=1, max_length=80)
    price: Optional[float] = None
    range: Optional[list[float]] = None

    @model_validator(mode="after")
    def price_or_range(self) -> KeyLevelOut:
        has_price = self.price is not None
        has_range = self.range is not None and len(self.range) == 2
        if has_price and has_range:
            raise ValueError("key_levels item must use price OR range, not both")
        if not has_price and not has_range:
            raise ValueError("key_levels item requires price or range [low, high]")
        if has_range:
            assert self.range is not None
            lo, hi = float(self.range[0]), float(self.range[1])
            if lo > hi:
                raise ValueError("range[0] must be <= range[1]")
            self.range = [lo, hi]
        return self


class ScenarioOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: ScenarioLabel
    direction: Literal["Long", "Short", "Either"]
    confidence: Literal["High", "Medium", "Low"]
    title: str = Field(min_length=1, max_length=120)
    trigger: Optional[float] = None
    target: Optional[float] = None
    stop: Optional[float] = None
    range: Optional[list[float]] = None

    @field_validator("range")
    @classmethod
    def validate_range(cls, v: Optional[list[float]]) -> Optional[list[float]]:
        if v is None:
            return None
        if len(v) != 2:
            raise ValueError("scenario range must be [low, high]")
        lo, hi = float(v[0]), float(v[1])
        if lo > hi:
            raise ValueError("scenario range[0] must be <= range[1]")
        return [lo, hi]

    @model_validator(mode="after")
    def levels_or_range(self) -> ScenarioOut:
        has_directional = any(x is not None for x in (self.trigger, self.target, self.stop))
        has_range = self.range is not None
        if has_directional and has_range:
            raise ValueError("scenario must use trigger/target/stop OR range, not both")
        if not has_directional and not has_range:
            raise ValueError("scenario requires trigger/target/stop or range")
        return self


class ClaudeLargeCapVerdictJson(BaseModel):
    """Blueprint §9 — fields Claude returns (comps injected server-side)."""

    model_config = ConfigDict(extra="forbid")

    ticker: str = Field(min_length=1)
    verdict: Literal["Trade", "No Trade"]
    verdict_reason: str = Field(min_length=1)
    bias: Literal["Bullish", "Bearish", "Neutral"]
    big_picture: str = Field(min_length=1)
    recent_action: list[str] = Field(min_length=1, max_length=8)
    pre_market: Optional[list[str]] = Field(default=None, max_length=8)
    key_levels: list[KeyLevelOut] = Field(default_factory=list, max_length=8)
    scenarios: list[ScenarioOut]

    @field_validator("recent_action", "pre_market")
    @classmethod
    def non_empty_bullets(cls, v: Optional[list[str]]) -> Optional[list[str]]:
        if v is None:
            return None
        cleaned = [s.strip() for s in v if isinstance(s, str) and s.strip()]
        if len(cleaned) != len(v):
            raise ValueError("bullet arrays must be non-empty strings")
        return cleaned

    @model_validator(mode="after")
    def trade_or_no_trade_rules(self) -> ClaudeLargeCapVerdictJson:
        if self.verdict == "No Trade":
            if len(self.scenarios) != 0:
                raise ValueError("No Trade verdict requires scenarios to be an empty array")
            if self.key_levels:
                raise ValueError("No Trade verdict requires key_levels to be an empty array")
        else:
            if len(self.scenarios) != 3:
                raise ValueError("Trade verdict requires exactly 3 scenarios")
            labels = sorted(s.label for s in self.scenarios)
            if labels != ["A", "B", "C"]:
                raise ValueError("Trade scenarios must have labels A, B, and C exactly once each")
            if len(self.key_levels) < 4:
                raise ValueError("Trade verdict requires at least 4 key_levels rows")
        if self.pre_market is not None and len(self.pre_market) < 1:
            raise ValueError("pre_market must be omitted or contain at least one bullet")
        return self


# --- UI comps schema (server-injected from digest.historical_analogues) ---


class CompsExampleOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    comp_gap_pct: float
    outcome: CompsOutcome
    outcome_pct: float


class CompsOut(BaseModel):
    """UI display shape — merged as verdict.comps after synthesis."""

    model_config = ConfigDict(extra="forbid")

    total: int = Field(ge=0)
    follow_through: int = Field(ge=0)
    reversal: int = Field(ge=0)
    flat: int = Field(ge=0)
    avg_next_day_range_pct: float
    avg_follow_through_pct: float
    avg_reversal_pct: float
    recent_examples: list[CompsExampleOut] = Field(max_length=3)
    low_sample: bool

    @model_validator(mode="after")
    def counts_sum_to_total(self) -> CompsOut:
        if self.follow_through + self.reversal + self.flat != self.total:
            raise ValueError("follow_through + reversal + flat must equal total")
        return self


class LargeCapVerdictJson(ClaudeLargeCapVerdictJson):
    """Full UI contract — Claude fields plus server-injected comps (stage 2 merge)."""

    model_config = ConfigDict(extra="forbid")

    comps: CompsOut


# Backward-compat alias for imports expecting the old name during migration.
LargeCapVerdictJsonFromClaude = ClaudeLargeCapVerdictJson

_CODE_FENCE_RE = re.compile(r"^```(?:json)?\s*", re.IGNORECASE)


def strip_markdown_code_fences(raw: str) -> str:
    t = raw.strip()
    t = _CODE_FENCE_RE.sub("", t)
    if t.endswith("```"):
        t = t[: t.rfind("```")].strip()
    return t.strip()


def parse_verdict_json(text: str) -> dict[str, Any]:
    """Validate Claude §9 JSON (without comps). Merge comps in synthesis pipeline (stage 2)."""
    cleaned = strip_markdown_code_fences(text)
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError as e:
        raise ValueError(f"Claude response is not valid JSON: {e}") from e
    if not isinstance(data, dict):
        raise ValueError("Claude JSON root must be an object")
    if "comps" in data:
        raise ValueError("Claude must not output comps — it is injected server-side")
    validated = ClaudeLargeCapVerdictJson.model_validate(data)
    out = validated.model_dump(exclude_none=True)
    validate_scenario_a_bias_alignment(out)
    return out


def synthesize_large_cap_verdict(
    digest: dict[str, Any],
    *,
    model: Optional[str] = None,
    timeout_seconds: float = 120.0,
) -> dict[str, Any]:
    """
    Call Anthropic Messages API with digest JSON; return validated §9 dict.

    Raises ValueError on missing key, parse errors, or validation failures.
    Raises anthropic.APIStatusError etc. on HTTP/API errors from SDK.
    """
    api_key = (os.environ.get("ANTHROPIC_API_KEY") or "").strip()
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY is not set")

    sym = digest.get("identity", {}).get("ticker")
    if not sym:
        raise ValueError("digest.identity.ticker is required")

    model_id = (model or os.environ.get("ANTHROPIC_LARGE_CAP_MODEL") or "").strip() or DEFAULT_LARGE_CAP_MODEL

    import anthropic

    client = anthropic.Anthropic(api_key=api_key, timeout=timeout_seconds)

    digest_json = json.dumps(digest, ensure_ascii=False, separators=(",", ":"))
    user_content = USER_MESSAGE_SCHEMA_REMINDER + "\n\nDigest JSON:\n" + digest_json

    logger.info(
        "large_cap_claude_call start model=%s ticker=%s digest_bytes=%s",
        model_id,
        sym,
        len(digest_json.encode("utf-8")),
    )

    message = client.messages.create(
        model=model_id,
        max_tokens=MAX_OUTPUT_TOKENS,
        system=SYSTEM_PROMPT_LARGE_CAP_ANALYSIS,
        messages=[{"role": "user", "content": user_content}],
    )

    logger.info(
        "large_cap_claude_call done model=%s ticker=%s usage=%s",
        model_id,
        sym,
        getattr(message, "usage", None),
    )

    parts = getattr(message, "content", None) or []
    texts: list[str] = []
    for block in parts:
        if hasattr(block, "text") and isinstance(getattr(block, "text", None), str):
            texts.append(block.text)
    combined = "".join(texts).strip()
    if not combined:
        raise ValueError("Claude returned empty text content")

    out = parse_verdict_json(combined)

    digest_ticker = str(sym).strip().upper()
    out_ticker = str(out.get("ticker", "")).strip().upper()
    if out_ticker != digest_ticker:
        raise ValueError(f"ticker mismatch: digest has {digest_ticker!r}, model returned {out_ticker!r}")

    return out
