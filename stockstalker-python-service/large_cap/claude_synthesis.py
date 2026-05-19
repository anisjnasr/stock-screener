"""
Large Cap Analysis — Claude synthesis (blueprint §8a–§9).

Interpretation only; all numbers live in the digest. API key never leaves the server.
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

logger = logging.getLogger(__name__)

# Default from blueprint §8a; override with ANTHROPIC_LARGE_CAP_MODEL (e.g. claude-opus-4-7).
DEFAULT_LARGE_CAP_MODEL = "claude-sonnet-4-6"
MAX_OUTPUT_TOKENS = 8192

# --- Blueprint §8b system prompt (verbatim operational instructions) ---
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
- **The timescale of a break matters.** Breaking a 6-month base is a far more significant event than breaking a 4-day pause, and should imply a larger, more reliable directional move. Let this shape both your verdict confidence and your scenario targets: a long-base break warrants larger `expected_move_pct` and more decisive scenarios; a break of only a very short range is weaker and may not even justify a Trade verdict on its own.
- Use your judgment about which timescale is in play. The digest deliberately does not pick one for you — that assessment is yours. A stock can be breaking out on one timescale while still inside its range on another; weigh the whole picture.
- Reference the relevant timescale explicitly in your `verdict_reason` and scenario descriptions (e.g. "clears the ~3-month range high" rather than just "breaks out").

Rules:
- Base your assessment **only** on the digest provided. Do not assume data that is not present.
- If pre-market fields are null, assess using historical structure only and say so in your reasoning.
- Do not perform arithmetic on raw price series — the digest already contains computed metrics. Use them.
- Be concise and concrete. Every scenario must reference specific price levels and percentage moves drawn from the digest's key levels.
- You are a decision-support tool, not a financial advisor. Do not give buy/sell recommendations or guarantees. Frame scenarios as probabilities, not predictions.
- Set the trigger, target, and invalidation of each scenario at genuinely meaningful, distinct price levels. The target should be a level the move would plausibly *reach*, and the invalidation a level that would genuinely *disprove* the scenario — they should not be jammed close together. Well-spaced, meaningful levels also make each call cleanly verifiable after the fact.
- Output **only** valid JSON matching the schema you are given. No preamble, no markdown, no code fences.

Structure your output as structured narrative sections, decision key levels, and scenarios. Do not blend forward price paths into the narrative sections:
- **narrative_sections** — short, scannable context (1–2 sentences per section max). No bullet lists. No forward scenario paths here.
  - **big_picture**: multi-timescale structure, trend, and where the stock sits in its ranges.
  - **recent_action**: last few sessions — range expansion, rejection, pause, or drift into key levels.
  - **historical_analogues**: what comparable prior setups did next; cite match_count honestly; if low_sample or match_count is 0, say so plainly.
  - **pre_market**: gap, last price vs prior close, volume vs baseline, and whether pre-market upgraded/downgraded the historical read. If pre-market data is absent, write one sentence stating historical-only assessment.
- **decision_levels** — exactly **1–3** rows that determine today's scenarios. Each row has three parts: **role** (Trigger, Target, Invalidation, Range, etc.), **source** (the structural origin from the digest — name the exact level, e.g. Prior day high, Top of consolidation area, Recent swing low, 20-day EMA; never use vague labels like "Primary scenario"), and either a **price** or **zone_low + zone_high** for a range band. Pick prices from digest key levels; the source must explain which digest level you chose.
- The **scenarios** are the *discrete forward paths*: concrete, distinct ways the session could resolve, each anchored to specific price levels.

Use the historical analogues — this is central to the tool's value:
- The digest contains an `historical_analogues` block: prior days when this same stock was in a similar setup, and what each did next, with summary tendencies across the set.
- Put analogue findings in **narrative_sections.historical_analogues** — e.g. "in the last N comparable gap-ups, the stock followed through on most and reversed on one", and cite a specific dated instance or two when useful.
- Let the analogue tendencies inform your **confidence tags** and which scenario you rank first. If the precedents lean strongly one way, the matching scenario earns higher confidence.
- **Honesty about sample size is mandatory.** If the analogue block has a `low_sample` flag or a low `match_count`, say so plainly in **historical_analogues** ("only 2 close precedents, so treat this as weak evidence") and do not present a thin sample as a reliable pattern. If `match_count` is 0, say there are no clear precedents and rely on structure alone. Never invent or imply analogues that are not in the digest.

For a **Trade** verdict, provide exactly 3 scenarios, ranked most-probable first, each with a confidence tag of "High", "Medium", or "Low".
- **The scenarios must genuinely span the range of outcomes — a stock can always fail to do what is expected.** They must not be three variations of the same direction. Whenever the setup points one way (e.g. a pre-market gap up), the scenario set must still include the ways it fails: one scenario for the expected move following through, one for it failing/reversing, and one for it going nowhere (consolidating, no trend). For a gap-up that is: gap-up-and-breakout, gap-up-and-fail/reverse, gap-up-and-consolidate. Apply the mirror logic to a gap-down.
- The three confidence tags should honestly reflect how lopsided the setup is. A clean, well-supported setup might read High / Medium / Low. A genuinely uncertain one might read Medium / Medium / Low — and that is correct; do not manufacture a High to look decisive.
- Each scenario has a short title and a one-line description referencing its levels.

For a **No Trade** verdict, provide an empty scenarios list. The narrative sections still apply — explain why the stock looks rangebound or lacks an edge.
"""

USER_MESSAGE_SCHEMA_REMINDER = """Output a single JSON object with exactly these keys and types:
- ticker: string (must match digest identity.ticker)
- verdict: \"Trade\" or \"No Trade\"
- verdict_reason: string, one concise sentence (short one-liner for UI)
- bias: \"Bullish\", \"Bearish\", or \"Neutral\"
- narrative_sections: object with keys big_picture, recent_action, historical_analogues, pre_market (each a string, 1–2 sentences; no forward price-path list)
- decision_levels: array of 1–3 items for Trade (0–2 for No Trade). Each { role: string (Trigger|Target|Invalidation|Range|Support|Resistance), source: string naming the digest structural level (e.g. Prior day high, Top of consolidation area, Recent swing low, 55-session range high — never "Primary scenario"), price: number } OR { role, source, zone_low: number, zone_high: number } for a range band. Do not dump every digest level.
- narrative: string, optional legacy summary — omit if narrative_sections is complete
- scenarios: array. If verdict is Trade: exactly 3 objects ranked 1–3 with fields rank (1–3), confidence (\"High\"|\"Medium\"|\"Low\"), title, description, key_levels { trigger, target, invalidation } (numbers), expected_move_pct (number), direction (\"Long\"|\"Short\"|\"Either\"). If No Trade: empty array [].

Do not wrap in markdown. No text before or after the JSON."""


class KeyLevels(BaseModel):
    model_config = ConfigDict(extra="forbid")

    trigger: float
    target: float
    invalidation: float


class NarrativeSectionsOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    big_picture: str = Field(min_length=1)
    recent_action: str = Field(min_length=1)
    historical_analogues: str = Field(min_length=1)
    pre_market: str = Field(min_length=1)


class DecisionLevelOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: Optional[str] = Field(default=None, max_length=80)
    source: Optional[str] = Field(default=None, max_length=120)
    label: Optional[str] = Field(default=None, max_length=120)
    price: Optional[float] = None
    zone_low: Optional[float] = None
    zone_high: Optional[float] = None
    low_label: Optional[str] = Field(default=None, max_length=120)
    high_label: Optional[str] = Field(default=None, max_length=120)

    @model_validator(mode="after")
    def price_or_zone(self) -> DecisionLevelOut:
        has_price = self.price is not None
        has_zone = self.zone_low is not None and self.zone_high is not None
        if has_price and has_zone:
            raise ValueError("decision_levels item must use price OR zone bounds, not both")
        if not has_price and not has_zone:
            raise ValueError("decision_levels item requires price or zone_low and zone_high")
        if not (
            (self.role and self.role.strip() and self.source and self.source.strip())
            or (self.label and self.label.strip())
        ):
            raise ValueError("decision_levels item requires role+source or legacy label")
        if has_zone:
            assert self.zone_low is not None and self.zone_high is not None
            if self.zone_low > self.zone_high:
                raise ValueError("zone_low must be <= zone_high")
        return self


class ScenarioOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rank: int = Field(ge=1, le=3)
    confidence: Literal["High", "Medium", "Low"]
    title: str = Field(min_length=1)
    description: str = Field(min_length=1)
    key_levels: KeyLevels
    expected_move_pct: float
    direction: Literal["Long", "Short", "Either"]


class LargeCapVerdictJson(BaseModel):
    """Blueprint §9 — validated app contract."""

    model_config = ConfigDict(extra="ignore")

    ticker: str = Field(min_length=1)
    verdict: Literal["Trade", "No Trade"]
    verdict_reason: str = Field(min_length=1)
    bias: Literal["Bullish", "Bearish", "Neutral"]
    narrative: Optional[str] = None
    narrative_sections: Optional[NarrativeSectionsOut] = None
    decision_levels: Optional[list[DecisionLevelOut]] = None
    scenarios: list[ScenarioOut]

    @model_validator(mode="after")
    def narrative_and_scenarios_valid(self) -> LargeCapVerdictJson:
        if self.narrative_sections is None and not (self.narrative and self.narrative.strip()):
            raise ValueError("Provide narrative_sections or legacy narrative string")
        if self.decision_levels is not None:
            if len(self.decision_levels) > 3:
                raise ValueError("decision_levels may contain at most 3 items")
            if self.verdict == "Trade" and len(self.decision_levels) < 1:
                raise ValueError("Trade verdict requires 1–3 decision_levels")
        if self.verdict == "No Trade":
            if len(self.scenarios) != 0:
                raise ValueError("No Trade verdict requires scenarios to be an empty array")
        else:
            if len(self.scenarios) != 3:
                raise ValueError("Trade verdict requires exactly 3 scenarios")
            ranks = sorted(s.rank for s in self.scenarios)
            if ranks != [1, 2, 3]:
                raise ValueError("Trade scenarios must have rank 1, 2, and 3 exactly once each")
        return self


_CODE_FENCE_RE = re.compile(r"^```(?:json)?\s*", re.IGNORECASE)


def strip_markdown_code_fences(raw: str) -> str:
    t = raw.strip()
    t = _CODE_FENCE_RE.sub("", t)
    if t.endswith("```"):
        t = t[: t.rfind("```")].strip()
    return t.strip()


def parse_verdict_json(text: str) -> dict[str, Any]:
    cleaned = strip_markdown_code_fences(text)
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError as e:
        raise ValueError(f"Claude response is not valid JSON: {e}") from e
    if not isinstance(data, dict):
        raise ValueError("Claude JSON root must be an object")
    validated = LargeCapVerdictJson.model_validate(data)
    out = validated.model_dump(exclude_none=True)
    sections = out.get("narrative_sections")
    if sections and not out.get("narrative"):
        out["narrative"] = " ".join(
            str(sections.get(k, "")).strip()
            for k in ("big_picture", "recent_action", "historical_analogues", "pre_market")
            if str(sections.get(k, "")).strip()
        )
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
