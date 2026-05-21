import type { LargeCapDataMode } from "@/lib/premarket/large-cap-settings-storage";
import {
  buildVerdictSections,
  capitalizeBulletStart,
  isV2Verdict,
  mapHistoricalAnaloguesToComps,
  type KeyLevelDisplay,
  type VerdictSectionBlock,
} from "@/lib/premarket/large-cap-verdict-display";

export type NarrativeSections = {
  big_picture: string;
  recent_action: string;
  historical_analogues: string;
  pre_market: string;
};

export type DecisionLevel = {
  role: string;
  source: string;
  price?: number;
  zone_low?: number;
  zone_high?: number;
};

export type NarrativeBlock =
  | VerdictSectionBlock
  | { kind: "text"; id: string; title: string; body: string }
  | { kind: "bullets"; id: string; title: string; items: string[] }
  | { kind: "levels"; id: "key_levels"; title: string; levels: DecisionLevel[] };

const BULLET_SECTION_IDS = new Set<keyof NarrativeSections>(["recent_action", "historical_analogues"]);

export const LC_SECTION_HEADER_COLOR = "var(--ws-cyan)";

const SECTION_KEYS: Array<keyof NarrativeSections> = [
  "big_picture",
  "recent_action",
  "historical_analogues",
  "pre_market",
];

const ROUTE_ORDER: Array<keyof NarrativeSections> = [
  "historical_analogues",
  "pre_market",
  "recent_action",
  "big_picture",
];

const DISTRIBUTE_ORDER: Array<keyof NarrativeSections> = [
  "big_picture",
  "recent_action",
  "historical_analogues",
  "pre_market",
];

const ROUTE_PATTERNS: Record<keyof NarrativeSections, RegExp> = {
  historical_analogues:
    /\b(analogue|analog|precedent|comparable|match_count|similar setup|prior instance|historical|followed through|reversed on|precedents?)\b/i,
  pre_market:
    /\b(pre-?market|premarket|\bgap\b|overnight|pm volume|pm vol|before the open|relative volume|rvol)\b/i,
  recent_action:
    /\b(yesterday|last session|prior session|recent|last few|prior day|range expansion|true range|tr vs|prior close|inside day|last close|prior session)\b/i,
  big_picture:
    /\b(base|multi-?month|timescale|range|trend|ema|structure|52-?week|longer|intermediate|consolidat|sideways|window|long_base)\b/i,
};

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function fmtPrice(n: unknown): string {
  if (typeof n === "number" && Number.isFinite(n)) return `$${n.toFixed(2)}`;
  return "—";
}

function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n+/)) {
    const p = para.trim();
    if (!p) continue;
    const matches = p.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
    if (matches) out.push(...matches.map((m) => m.trim()).filter(Boolean));
  }
  return out;
}

/** Split section prose into bullet items for display. */
export function textToBulletItems(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const lines = trimmed
    .split(/\n+/)
    .map((line) => line.replace(/^[\s•\-–*]+/, "").trim())
    .filter(Boolean);
  if (lines.length > 1) return lines.map(capitalizeBulletStart);

  if (trimmed.includes(";")) {
    return trimmed
      .split(";")
      .map((part) => capitalizeBulletStart(part.trim()))
      .filter(Boolean);
  }

  return splitSentences(trimmed).map(capitalizeBulletStart);
}

function sectionsFromRaw(raw: unknown): NarrativeSections {
  const empty = (): NarrativeSections => ({
    big_picture: "",
    recent_action: "",
    historical_analogues: "",
    pre_market: "",
  });
  if (!raw || typeof raw !== "object") return empty();
  const o = raw as Record<string, unknown>;
  return {
    big_picture: asString(o.big_picture),
    recent_action: asString(o.recent_action),
    historical_analogues: asString(o.historical_analogues),
    pre_market: asString(o.pre_market),
  };
}

function sectionsUsable(sections: NarrativeSections): boolean {
  const filled = SECTION_KEYS.filter((k) => sections[k].length > 0);
  if (filled.length < 2) return false;
  const total = SECTION_KEYS.reduce((n, k) => n + sections[k].length, 0);
  const bp = sections.big_picture.length;
  if (bp > 0 && filled.length <= 2 && total > 0 && bp / total > 0.85) return false;
  return true;
}

export function splitNarrativeIntoSections(narrative: string): NarrativeSections {
  const sentences = splitSentences(narrative);
  const buckets: Record<keyof NarrativeSections, string[]> = {
    big_picture: [],
    recent_action: [],
    historical_analogues: [],
    pre_market: [],
  };
  const unassigned: string[] = [];

  for (const sentence of sentences) {
    let placed = false;
    for (const key of ROUTE_ORDER) {
      if (ROUTE_PATTERNS[key].test(sentence)) {
        buckets[key].push(sentence);
        placed = true;
        break;
      }
    }
    if (!placed) unassigned.push(sentence);
  }

  unassigned.forEach((sentence, i) => {
    buckets[DISTRIBUTE_ORDER[i % DISTRIBUTE_ORDER.length]].push(sentence);
  });

  return {
    big_picture: buckets.big_picture.join(" ").trim(),
    recent_action: buckets.recent_action.join(" ").trim(),
    historical_analogues: buckets.historical_analogues.join(" ").trim(),
    pre_market: buckets.pre_market.join(" ").trim(),
  };
}

function digestSectionFallbacks(
  digest: Record<string, unknown>,
  dataMode: LargeCapDataMode
): Partial<NarrativeSections> {
  const out: Partial<NarrativeSections> = {};

  const trend = asString((digest.trend_and_momentum as Record<string, unknown> | undefined)?.trend_label);
  const multi = (digest.multi_timescale_ranges ?? {}) as Record<string, unknown>;
  const short = (multi.short ?? {}) as Record<string, unknown>;
  const longer = (multi.longer ?? {}) as Record<string, unknown>;
  const base = (multi.long_base ?? {}) as Record<string, unknown>;
  const bigBits: string[] = [];
  if (trend) bigBits.push(`Trend label: ${trend}.`);
  if (short.high != null && short.low != null) {
    bigBits.push(
      `Short window (${multi.short_sessions ?? "?"} sessions): ${fmtPrice(short.low)}–${fmtPrice(short.high)}.`
    );
  }
  if (longer.high != null && longer.low != null) {
    bigBits.push(
      `Longer window (${multi.longer_sessions ?? "?"} sessions): ${fmtPrice(longer.low)}–${fmtPrice(longer.high)}.`
    );
  }
  if (base.high != null && base.low != null) {
    bigBits.push(
      `Long base (${multi.long_base_sessions ?? "?"} sessions): ${fmtPrice(base.low)}–${fmtPrice(base.high)}.`
    );
  }
  if (bigBits.length) out.big_picture = bigBits.join(" ");

  const recent = (digest.recent_price_structure ?? {}) as Record<string, unknown>;
  const prior = (recent.prior_day ?? {}) as Record<string, unknown>;
  const vol = (digest.volatility_and_range ?? {}) as Record<string, unknown>;
  const recentBits: string[] = [];
  if (prior.close != null) recentBits.push(`Prior session close ${fmtPrice(prior.close)}.`);
  if (typeof recent.last_close_vs_prior_session_close_pct === "number") {
    recentBits.push(
      `Last close vs prior session: ${recent.last_close_vs_prior_session_close_pct > 0 ? "+" : ""}${recent.last_close_vs_prior_session_close_pct.toFixed(2)}%.`
    );
  }
  if (typeof vol.prior_session_tr_vs_atr_ratio === "number") {
    recentBits.push(`Prior session TR/ATR ratio: ${vol.prior_session_tr_vs_atr_ratio.toFixed(2)}.`);
  }
  if (recentBits.length) out.recent_action = recentBits.join(" ");

  const analogues = (digest.historical_analogues ?? {}) as Record<string, unknown>;
  if (typeof analogues.match_count === "number") {
    const mc = analogues.match_count;
    const tend = (analogues.summary_tendencies ?? {}) as Record<string, unknown>;
    const bits = [`${mc} comparable analogue${mc === 1 ? "" : "s"}.`];
    if (mc > 0) {
      bits.push(
        `Next session: ${tend.follow_through_count ?? 0} follow-through, ${tend.reversed_count ?? 0} reversed, ${tend.flat_or_chop_count ?? 0} chop.`
      );
    }
    if (analogues.low_sample) bits.push("Low sample — treat as weak evidence.");
    out.historical_analogues = bits.join(" ");
  }

  if (dataMode === "historical_premarket") {
    const pm = (digest.premarket ?? {}) as Record<string, unknown>;
    const pmBits: string[] = [];
    if (pm.last_price != null) pmBits.push(`Pre-market last ${fmtPrice(pm.last_price)}.`);
    if (typeof pm.gap_pct_vs_prior_close === "number") {
      pmBits.push(`Gap vs prior close: ${pm.gap_pct_vs_prior_close > 0 ? "+" : ""}${pm.gap_pct_vs_prior_close.toFixed(2)}%.`);
    }
    if (typeof pm.volume === "number") pmBits.push(`Pre-market volume ${Math.round(pm.volume).toLocaleString()}.`);
    if (typeof pm.relative_volume_vs_baseline === "number") {
      pmBits.push(`Relative volume vs baseline: ${pm.relative_volume_vs_baseline.toFixed(2)}x.`);
    }
    if (pm.premarket_changes_picture === true) pmBits.push("Pre-market changes the historical read.");
    if (pmBits.length) out.pre_market = pmBits.join(" ");
  } else {
    out.pre_market = "Historical-only mode — no pre-market data in this run.";
  }

  return out;
}

function fillEmptySections(
  sections: NarrativeSections,
  digest: Record<string, unknown> | undefined,
  dataMode: LargeCapDataMode
): NarrativeSections {
  if (!digest) return sections;
  const fallbacks = digestSectionFallbacks(digest, dataMode);
  const next = { ...sections };
  for (const key of SECTION_KEYS) {
    if (!next[key] && fallbacks[key]) next[key] = fallbacks[key]!;
  }
  return next;
}

type CatalogEntry = [price: number, label: string];

const GENERIC_SOURCES = new Set([
  "",
  "primary scenario",
  "scenario",
  "key level",
  "structural level",
  "price level",
  "rank-1 scenario",
]);

const EMA_LABELS: Record<string, string> = {
  ema_20: "20-day EMA",
  ema_50: "50-day EMA",
  ema_100: "100-day EMA",
  ema_200: "200-day EMA",
};

function priceMatchTolerance(price: number): number {
  return Math.max(0.02, Math.abs(price) * 0.001);
}

function safeCatalogPrice(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

function addCatalogEntry(catalog: CatalogEntry[], price: unknown, label: string): void {
  const p = safeCatalogPrice(price);
  if (p !== null) catalog.push([p, label]);
}

export function collectDigestLevelCatalog(digest: Record<string, unknown>): CatalogEntry[] {
  const catalog: CatalogEntry[] = [];

  const kl = (digest.key_levels ?? {}) as Record<string, unknown>;
  addCatalogEntry(catalog, kl.prior_day_high, "Prior day high");
  addCatalogEntry(catalog, kl.prior_day_low, "Prior day low");
  addCatalogEntry(catalog, kl.recent_swing_high, "Recent swing high");
  addCatalogEntry(catalog, kl.recent_swing_low, "Recent swing low");

  const fw = (kl.fifty_two_week ?? {}) as Record<string, unknown>;
  addCatalogEntry(catalog, fw.high_from_quote_daily, "52-week high");
  addCatalogEntry(catalog, fw.low_from_last_252_sessions, "52-week low");

  const recent = (digest.recent_price_structure ?? {}) as Record<string, unknown>;
  const prior = (recent.prior_day ?? {}) as Record<string, unknown>;
  addCatalogEntry(catalog, prior.open, "Prior day open");
  addCatalogEntry(catalog, prior.high, "Prior day high");
  addCatalogEntry(catalog, prior.low, "Prior day low");
  addCatalogEntry(catalog, prior.close, "Prior day close");
  addCatalogEntry(catalog, recent.high_last_5_sessions, "High of last 5 sessions");
  addCatalogEntry(catalog, recent.low_last_5_sessions, "Low of last 5 sessions");
  addCatalogEntry(catalog, recent.high_last_20_sessions, "High of last 20 sessions");
  addCatalogEntry(catalog, recent.low_last_20_sessions, "Low of last 20 sessions");

  const multi = (digest.multi_timescale_ranges ?? {}) as Record<string, unknown>;
  for (const [key, sessionsKey, isShortTight] of [
    ["short", "short_sessions", true],
    ["intermediate", "intermediate_sessions", false],
    ["longer", "longer_sessions", false],
    ["long_base", "long_base_sessions", false],
  ] as const) {
    const window = (multi[key] ?? {}) as Record<string, unknown>;
    const sessions = multi[sessionsKey];
    const tightness = window.tightness_range_vs_atr;
    const isTight = typeof tightness === "number" && tightness <= 1.5;
    if (isShortTight && isTight && key === "short") {
      addCatalogEntry(catalog, window.high, "Top of consolidation area");
      addCatalogEntry(catalog, window.low, "Bottom of consolidation area");
    } else {
      const suffix = typeof sessions === "number" ? `${sessions}-session` : "";
      addCatalogEntry(catalog, window.high, suffix ? `${suffix} range high` : "Range high");
      addCatalogEntry(catalog, window.low, suffix ? `${suffix} range low` : "Range low");
    }
  }

  const mtPairs = (kl.multi_timescale_highs_lows ?? {}) as Record<string, unknown>;
  for (const [key, sessionsKey] of [
    ["short", "short_sessions"],
    ["intermediate", "intermediate_sessions"],
    ["longer", "longer_sessions"],
    ["long_base", "long_base_sessions"],
  ] as const) {
    const pair = (mtPairs[key] ?? {}) as Record<string, unknown>;
    const sessions = multi[sessionsKey];
    const suffix = typeof sessions === "number" ? `${sessions}-session` : "";
    addCatalogEntry(catalog, pair.high, suffix ? `${suffix} range high` : "Range high");
    addCatalogEntry(catalog, pair.low, suffix ? `${suffix} range low` : "Range low");
  }

  const roundNums = (kl.round_numbers_near_last_close ?? {}) as Record<string, unknown>;
  addCatalogEntry(catalog, roundNums.below, "Round number below");
  addCatalogEntry(catalog, roundNums.above, "Round number above");

  const maLevels = (kl.moving_average_levels ?? {}) as Record<string, unknown>;
  for (const sideKey of ["nearest_moving_average_above", "nearest_moving_average_below"] as const) {
    const side = (maLevels[sideKey] ?? {}) as Record<string, unknown>;
    const emaKey = asString(side.key);
    const emaLabel = EMA_LABELS[emaKey] ?? (emaKey ? emaKey.replace(/_/g, " ") : sideKey);
    addCatalogEntry(catalog, side.value, emaLabel);
  }

  const vsMa = ((digest.trend_and_momentum as Record<string, unknown> | undefined)?.vs_moving_averages ??
    {}) as Record<string, unknown>;
  for (const [emaKey, label] of Object.entries(EMA_LABELS)) {
    addCatalogEntry(catalog, vsMa[emaKey], label);
  }

  const pm = digest.premarket;
  if (pm && typeof pm === "object") {
    const pmObj = pm as Record<string, unknown>;
    addCatalogEntry(catalog, pmObj.last_price, "Pre-market last price");
    addCatalogEntry(catalog, pmObj.high, "Pre-market high");
    addCatalogEntry(catalog, pmObj.low, "Pre-market low");
  }

  return catalog;
}

export function matchPriceToDigestSource(price: number, catalog: CatalogEntry[]): string | null {
  if (!catalog.length || !Number.isFinite(price) || price <= 0) return null;
  const tol = priceMatchTolerance(price);
  let bestLabel: string | null = null;
  let bestDelta: number | null = null;
  for (const [catalogPrice, label] of catalog) {
    const delta = Math.abs(catalogPrice - price);
    if (delta <= tol && (bestDelta === null || delta < bestDelta)) {
      bestLabel = label;
      bestDelta = delta;
    }
  }
  return bestLabel;
}

function isGenericSource(source: string): boolean {
  return GENERIC_SOURCES.has(source.trim().toLowerCase());
}

function enrichLevelSource(level: DecisionLevel, digest?: Record<string, unknown>): DecisionLevel {
  if (!digest || !isGenericSource(level.source)) return level;
  if (typeof level.price !== "number") return level;
  const matched = matchPriceToDigestSource(level.price, collectDigestLevelCatalog(digest));
  return matched ? { ...level, source: matched } : level;
}

function finalizeDecisionLevels(levels: DecisionLevel[], digest?: Record<string, unknown>): DecisionLevel[] {
  if (!digest) return levels;
  return levels.map((level) => enrichLevelSource(level, digest));
}

function levelsFromScenarioKeyLevels(
  kl: Record<string, unknown>,
  digest?: Record<string, unknown>
): DecisionLevel[] {
  const catalog = digest ? collectDigestLevelCatalog(digest) : [];
  const out: DecisionLevel[] = [];
  for (const [role, key] of [
    ["Trigger", "trigger"],
    ["Target", "target"],
    ["Invalidation", "invalidation"],
  ] as const) {
    const val = kl[key];
    if (typeof val !== "number" || !Number.isFinite(val)) continue;
    const source = catalog.length ? matchPriceToDigestSource(val, catalog) : null;
    out.push({ role, source: source ?? "Structural level", price: val });
  }
  return out.slice(0, 3);
}

export function inferDecisionLevels(
  verdict: Record<string, unknown>,
  digest?: Record<string, unknown>
): DecisionLevel[] {
  const parsed = parseDecisionLevels(verdict.decision_levels);
  if (parsed.length > 0) return finalizeDecisionLevels(parsed, digest);

  const scenarios = verdict.scenarios;
  if (Array.isArray(scenarios) && scenarios.length > 0) {
    const rank1 =
      (scenarios.find((s) => s && typeof s === "object" && (s as Record<string, unknown>).rank === 1) as
        | Record<string, unknown>
        | undefined) ?? (scenarios[0] as Record<string, unknown>);
    const kl = (rank1?.key_levels ?? {}) as Record<string, unknown>;
    const fromScenario = levelsFromScenarioKeyLevels(kl, digest);
    if (fromScenario.length) return finalizeDecisionLevels(fromScenario, digest);
  }

  if (digest) {
    const multi = (digest.multi_timescale_ranges ?? {}) as Record<string, unknown>;
    const short = (multi.short ?? {}) as Record<string, unknown>;
    if (typeof short.high === "number" && typeof short.low === "number") {
      const tightness = short.tightness_range_vs_atr;
      const sessions = multi.short_sessions;
      if (typeof tightness === "number" && tightness <= 1.5) {
        return [
          {
            role: "Range",
            source: sessions ? `${sessions}-session consolidation area` : "Short-window consolidation area",
            zone_low: Math.min(short.low, short.high),
            zone_high: Math.max(short.low, short.high),
          },
        ];
      }
    }

    const kl = (digest.key_levels ?? {}) as Record<string, unknown>;
    const out: DecisionLevel[] = [];
    if (typeof kl.prior_day_high === "number") {
      out.push({
        role: "Trigger",
        source: "Prior day high",
        price: kl.prior_day_high,
      });
    }
    if (typeof kl.prior_day_low === "number") {
      out.push({
        role: "Invalidation",
        source: "Prior day low",
        price: kl.prior_day_low,
      });
    }
    if (
      typeof kl.recent_swing_high === "number" &&
      typeof kl.recent_swing_low === "number" &&
      out.length < 2
    ) {
      return [
        {
          role: "Range",
          source: "Recent swing range",
          zone_low: Math.min(kl.recent_swing_low, kl.recent_swing_high),
          zone_high: Math.max(kl.recent_swing_low, kl.recent_swing_high),
        },
      ];
    }
    if (out.length) return out.slice(0, 3);
  }

  return [];
}

export function ensureNarrativeSections(
  verdict: Record<string, unknown> | undefined,
  digest: Record<string, unknown> | undefined,
  dataMode: LargeCapDataMode
): NarrativeSections {
  if (!verdict) {
    return { big_picture: "", recent_action: "", historical_analogues: "", pre_market: "" };
  }

  let sections = sectionsFromRaw(verdict.narrative_sections);
  const narrative = asString(verdict.narrative);

  if (!sectionsUsable(sections)) {
    const source =
      narrative ||
      sections.big_picture ||
      sections.recent_action ||
      sections.historical_analogues ||
      sections.pre_market;
    if (source) sections = splitNarrativeIntoSections(source);
    else if (digest) sections = sectionsFromRaw(digestSectionFallbacks(digest, dataMode));
  }

  return fillEmptySections(sections, digest, dataMode);
}

export const LC_KEY_LEVELS_GRID =
  "grid grid-cols-[minmax(4.5rem,0.85fr)_minmax(7rem,1.5fr)_minmax(5rem,1fr)] gap-x-3 gap-y-1.5 items-baseline";

export function formatDecisionLevelPrice(level: DecisionLevel): string {
  if (typeof level.price === "number" && Number.isFinite(level.price)) {
    return fmtPrice(level.price);
  }
  if (typeof level.zone_low === "number" && typeof level.zone_high === "number") {
    const lo = Math.min(level.zone_low, level.zone_high);
    const hi = Math.max(level.zone_low, level.zone_high);
    return `${fmtPrice(lo)} – ${fmtPrice(hi)}`;
  }
  return "—";
}

function inferRoleFromText(text: string): string | null {
  const t = text.toLowerCase();
  if (/invalidation|support|floor|breakdown|stop/.test(t)) return "Invalidation";
  if (/trigger|breakout|break above|entry|ceiling/.test(t)) return "Trigger";
  if (/target|resistance|objective|measured move/.test(t)) return "Target";
  if (/consolidation|range|zone|band/.test(t)) return "Range";
  return null;
}

function splitLegacyLabel(label: string): { role: string; source: string } {
  const parts = label.split(/\s*[—–-]\s*/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const [first, ...rest] = parts;
    const second = rest.join(" - ");
    const roleFromSecond = inferRoleFromText(second);
    const roleFromFirst = inferRoleFromText(first);
    if (roleFromSecond) return { role: roleFromSecond, source: first };
    if (roleFromFirst) return { role: roleFromFirst, source: second };
    return { role: second, source: first };
  }
  const role = inferRoleFromText(label);
  if (role) return { role, source: label };
  return { role: "Key level", source: label };
}

function parseDecisionLevelItem(row: Record<string, unknown>): DecisionLevel[] {
  const role = asString(row.role);
  const source = asString(row.source);
  const price = row.price;
  const zoneLow = row.zone_low;
  const zoneHigh = row.zone_high;
  const hasPrice = typeof price === "number" && Number.isFinite(price);
  const hasZone =
    typeof zoneLow === "number" &&
    Number.isFinite(zoneLow) &&
    typeof zoneHigh === "number" &&
    Number.isFinite(zoneHigh);

  if (role && source && (hasPrice || hasZone)) {
    const level: DecisionLevel = { role, source };
    if (hasPrice) level.price = price;
    if (hasZone) {
      level.zone_low = Math.min(zoneLow, zoneHigh);
      level.zone_high = Math.max(zoneLow, zoneHigh);
    }
    return [level];
  }

  const label = asString(row.label);
  if (!label) return [];

  if (hasZone && !hasPrice) {
    const lo = Math.min(zoneLow as number, zoneHigh as number);
    const hi = Math.max(zoneLow as number, zoneHigh as number);
    const lowLabel = asString(row.low_label);
    const highLabel = asString(row.high_label);
    const zoneSource = label || "Price range";
    const out: DecisionLevel[] = [];
    if (lowLabel) {
      const split = splitLegacyLabel(lowLabel);
      out.push({ role: split.role, source: zoneSource, price: lo });
    }
    if (highLabel) {
      const split = splitLegacyLabel(highLabel);
      out.push({ role: split.role, source: zoneSource, price: hi });
    }
    if (out.length === 0) {
      out.push({ role: "Range", source: zoneSource, zone_low: lo, zone_high: hi });
    }
    return out;
  }

  if (hasPrice) {
    const split = splitLegacyLabel(label);
    return [{ role: split.role, source: split.source, price }];
  }

  return [];
}

function parseDecisionLevels(raw: unknown): DecisionLevel[] {
  if (!Array.isArray(raw)) return [];
  const out: DecisionLevel[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    out.push(...parseDecisionLevelItem(item as Record<string, unknown>));
    if (out.length >= 3) break;
  }
  return out.slice(0, 3);
}

/** Split prose into sentence bullets without breaking decimals (e.g. 7.9%, 265.01). */
export function splitProseIntoBullets(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const lines = trimmed
    .split(/\n+/)
    .map((line) => line.replace(/^[\s•\-–*]+/, "").trim())
    .filter(Boolean);
  if (lines.length > 1) return lines.flatMap((line) => splitProseIntoBullets(line));

  if (trimmed.includes(";")) {
    const semi = trimmed
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean);
    if (semi.length > 1) return semi.flatMap((part) => splitProseIntoBullets(part));
  }

  const sentences = trimmed
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length > 1) return sentences.map(capitalizeBulletStart);

  return [capitalizeBulletStart(trimmed)];
}

const MAX_BULLET_WORDS = 22;

function expandBulletText(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const words = trimmed.split(/\s+/).length;
  const hasSentenceBreak = /(?<=[.!?])\s+/.test(trimmed);
  if (words <= MAX_BULLET_WORDS && !hasSentenceBreak) return [trimmed];
  return splitProseIntoBullets(trimmed);
}

/** Normalize bullet arrays: one short fact per item; split legacy long prose. */
export function normalizeBulletField(arrayRaw: unknown, proseFallback = ""): string[] {
  let items: string[] = [];
  if (Array.isArray(arrayRaw) && arrayRaw.length > 0) {
    items = arrayRaw.flatMap((item) => expandBulletText(String(item)));
  } else if (proseFallback.trim()) {
    items = expandBulletText(proseFallback);
  }
  return items.map(capitalizeBulletStart);
}

function decisionLevelToKeyLevel(level: DecisionLevel): KeyLevelDisplay {
  if (typeof level.zone_low === "number" && typeof level.zone_high === "number") {
    return {
      role: level.role,
      source: level.source,
      range: [Math.min(level.zone_low, level.zone_high), Math.max(level.zone_low, level.zone_high)],
    };
  }
  return { role: level.role, source: level.source, price: level.price };
}

/** Upgrade cached legacy verdicts to v2 display shape using digest + narrative_sections. */
export function coerceVerdictForDisplay(
  verdict: Record<string, unknown>,
  digest: Record<string, unknown> | undefined,
  dataMode: LargeCapDataMode
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...verdict };

  if (isV2Verdict(verdict)) {
    out.recent_action = normalizeBulletField(
      verdict.recent_action,
      typeof verdict.recent_action === "string" ? verdict.recent_action : ""
    );
    if (dataMode === "historical_premarket") {
      const pm = normalizeBulletField(
        verdict.pre_market,
        typeof verdict.pre_market === "string" ? verdict.pre_market : ""
      );
      if (pm.length > 0) out.pre_market = pm;
      else delete out.pre_market;
    }
    if (!verdict.comps && digest?.historical_analogues && typeof digest.historical_analogues === "object") {
      out.comps = mapHistoricalAnaloguesToComps(digest.historical_analogues);
    }
    return out;
  }

  const sections = ensureNarrativeSections(verdict, digest, dataMode);

  if (sections.big_picture.trim()) out.big_picture = sections.big_picture.trim();

  const recent = normalizeBulletField(verdict.recent_action, sections.recent_action);
  if (recent.length > 0) out.recent_action = recent;

  if (dataMode === "historical_premarket") {
    const pm = normalizeBulletField(verdict.pre_market, sections.pre_market);
    if (pm.length > 0) out.pre_market = pm;
  }

  const analogues = digest?.historical_analogues;
  if (analogues && typeof analogues === "object") {
    out.comps = mapHistoricalAnaloguesToComps(analogues);
  } else if (verdict.comps) {
    out.comps = verdict.comps;
  }

  const decisionLevels = inferDecisionLevels(verdict, digest);
  if (decisionLevels.length > 0) {
    out.key_levels = decisionLevels.map(decisionLevelToKeyLevel);
  }

  return out;
}

export function buildNarrativeBlocks(
  verdict: Record<string, unknown> | undefined,
  dataMode: LargeCapDataMode,
  digest?: Record<string, unknown>
): NarrativeBlock[] {
  if (!verdict) return [];

  const displayVerdict = coerceVerdictForDisplay(verdict, digest, dataMode);
  if (isV2Verdict(displayVerdict)) {
    return buildVerdictSections(displayVerdict, dataMode);
  }

  const sections = ensureNarrativeSections(verdict, digest, dataMode);
  const decisionLevels = inferDecisionLevels(verdict, digest);
  const blocks: NarrativeBlock[] = [];

  const textSections: Array<{ id: keyof NarrativeSections; title: string }> = [
    { id: "big_picture", title: "Big Picture" },
    { id: "recent_action", title: "Recent Action" },
    { id: "historical_analogues", title: "Historical Analogues" },
  ];

  for (const { id, title } of textSections) {
    const body = sections[id];
    if (!body) continue;
    if (BULLET_SECTION_IDS.has(id)) {
      blocks.push({ kind: "bullets", id, title, items: textToBulletItems(body) });
    } else {
      blocks.push({ kind: "text", id, title, body });
    }
  }

  if (decisionLevels.length > 0) {
    blocks.push({ kind: "levels", id: "key_levels", title: "Key Levels", levels: decisionLevels });
  }

  if (dataMode === "historical_premarket" && sections.pre_market) {
    blocks.push({ kind: "text", id: "pre_market", title: "Pre-Market", body: sections.pre_market });
  }

  return blocks;
}
