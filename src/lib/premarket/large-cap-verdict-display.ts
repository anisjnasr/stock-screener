import type { LargeCapDataMode } from "@/lib/premarket/large-cap-settings-storage";

export type CompsDisplay = {
  total: number;
  follow_through: number;
  reversal: number;
  flat: number;
  avg_next_day_range_pct: number;
  avg_follow_through_pct: number;
  avg_reversal_pct: number;
  low_sample: boolean;
  recent_examples: Array<{
    date: string;
    comp_gap_pct: number;
    outcome: "follow_through" | "reversal" | "flat";
    outcome_pct: number;
  }>;
};

export type KeyLevelDisplay = {
  role: string;
  source: string;
  price?: number;
  range?: [number, number];
};

export type VerdictSectionBlock =
  | { kind: "text"; id: string; title: string; body: string }
  | { kind: "bullets"; id: string; title: string; items: string[] }
  | { kind: "comps"; id: "comps"; title: string; comps: CompsDisplay }
  | { kind: "levels"; id: "key_levels"; title: string; levels: KeyLevelDisplay[] };

export const LC_SECTION_HEADER_COLOR = "var(--ws-cyan)";
export const LC_KEY_LEVELS_GRID =
  "grid grid-cols-[minmax(4.5rem,0.85fr)_minmax(7rem,1.5fr)_minmax(5rem,1fr)] gap-x-3 gap-y-1.5 items-baseline";

export function isV2Verdict(verdict: Record<string, unknown> | undefined): boolean {
  if (!verdict) return false;
  return typeof verdict.big_picture === "string" || Array.isArray(verdict.recent_action);
}

export function formatSignedPct(n: unknown): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const body = abs.toFixed(2).replace(/\.?0+$/, "") || "0";
  return `${sign}${body}%`;
}

export function capitalizeBulletStart(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  const idx = trimmed.search(/[a-zA-Z]/);
  if (idx === -1) return trimmed;
  return trimmed.slice(0, idx) + trimmed.charAt(idx).toUpperCase() + trimmed.slice(idx + 1);
}

export function formatMonoPrice(n: unknown): string {
  if (typeof n === "number" && Number.isFinite(n)) return n.toFixed(2);
  return "—";
}

export function formatKeyLevelPrice(level: KeyLevelDisplay): string {
  if (typeof level.price === "number" && Number.isFinite(level.price)) {
    return formatMonoPrice(level.price);
  }
  if (level.range && level.range.length === 2) {
    const lo = Math.min(level.range[0], level.range[1]);
    const hi = Math.max(level.range[0], level.range[1]);
    return `${formatMonoPrice(lo)} – ${formatMonoPrice(hi)}`;
  }
  return "—";
}

/** Map digest `historical_analogues` → UI comps (mirrors Python comps_mapping). */
export function mapHistoricalAnaloguesToComps(block: unknown): CompsDisplay {
  const o = block && typeof block === "object" ? (block as Record<string, unknown>) : {};
  const tend =
    o.summary_tendencies && typeof o.summary_tendencies === "object"
      ? (o.summary_tendencies as Record<string, unknown>)
      : {};
  const follow_through = Number(tend.follow_through_count) || 0;
  const reversal = Number(tend.reversed_count) || 0;
  const flat = Number(tend.flat_or_chop_count) || 0;
  let total = o.match_count != null ? Number(o.match_count) : follow_through + reversal + flat;
  if (follow_through + reversal + flat !== total) total = follow_through + reversal + flat;

  const avg_range =
    typeof tend.avg_next_day_true_range_pct_of_open === "number" &&
    Number.isFinite(tend.avg_next_day_true_range_pct_of_open)
      ? tend.avg_next_day_true_range_pct_of_open
      : 0;

  const outcomeMap: Record<string, CompsDisplay["recent_examples"][0]["outcome"]> = {
    follow_through: "follow_through",
    reversed: "reversal",
    neutral_chop: "flat",
  };

  const examplesRaw = Array.isArray(o.examples) ? o.examples : [];
  const ftPcts: number[] = [];
  const revPcts: number[] = [];
  const recent_examples: CompsDisplay["recent_examples"] = [];

  for (const ex of examplesRaw.slice(0, 3)) {
    if (!ex || typeof ex !== "object") continue;
    const row = ex as Record<string, unknown>;
    const ns = row.next_session && typeof row.next_session === "object" ? (row.next_session as Record<string, unknown>) : {};
    const rawLabel = String(ns.follow_through_label ?? "");
    const outcome = outcomeMap[rawLabel] ?? "flat";
    const outcome_pct = typeof ns.close_vs_open_pct === "number" ? ns.close_vs_open_pct : 0;
    const comp_gap_pct =
      typeof row.overnight_gap_pct_into_next_session === "number" ? row.overnight_gap_pct_into_next_session : 0;
    const date = String(row.analogue_session_date ?? "").trim();
    if (!date) continue;
    recent_examples.push({
      date,
      comp_gap_pct,
      outcome,
      outcome_pct,
    });
  }

  for (const ex of examplesRaw) {
    if (!ex || typeof ex !== "object") continue;
    const row = ex as Record<string, unknown>;
    const ns = row.next_session && typeof row.next_session === "object" ? (row.next_session as Record<string, unknown>) : {};
    const rawLabel = String(ns.follow_through_label ?? "");
    const pct = ns.close_vs_open_pct;
    if (typeof pct !== "number" || !Number.isFinite(pct)) continue;
    if (rawLabel === "follow_through") ftPcts.push(Math.abs(pct));
    else if (rawLabel === "reversed") revPcts.push(Math.abs(pct));
  }

  const avg = (vals: number[]) => (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0);

  return {
    total,
    follow_through,
    reversal,
    flat,
    avg_next_day_range_pct: avg_range,
    avg_follow_through_pct: avg(ftPcts),
    avg_reversal_pct: avg(revPcts),
    low_sample: Boolean(o.low_sample) || total < 20,
    recent_examples,
  };
}

function parseComps(raw: unknown): CompsDisplay | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const total = typeof o.total === "number" ? o.total : 0;
  const follow_through = typeof o.follow_through === "number" ? o.follow_through : 0;
  const reversal = typeof o.reversal === "number" ? o.reversal : 0;
  const flat = typeof o.flat === "number" ? o.flat : 0;
  return {
    total,
    follow_through,
    reversal,
    flat,
    avg_next_day_range_pct: typeof o.avg_next_day_range_pct === "number" ? o.avg_next_day_range_pct : 0,
    avg_follow_through_pct: typeof o.avg_follow_through_pct === "number" ? o.avg_follow_through_pct : 0,
    avg_reversal_pct: typeof o.avg_reversal_pct === "number" ? o.avg_reversal_pct : 0,
    low_sample: Boolean(o.low_sample),
    recent_examples: Array.isArray(o.recent_examples)
      ? o.recent_examples
          .filter((ex): ex is Record<string, unknown> => Boolean(ex && typeof ex === "object"))
          .slice(0, 3)
          .map((ex) => ({
            date: String(ex.date ?? ""),
            comp_gap_pct: typeof ex.comp_gap_pct === "number" ? ex.comp_gap_pct : 0,
            outcome: (ex.outcome === "follow_through" || ex.outcome === "reversal" || ex.outcome === "flat"
              ? ex.outcome
              : "flat") as CompsDisplay["recent_examples"][0]["outcome"],
            outcome_pct: typeof ex.outcome_pct === "number" ? ex.outcome_pct : 0,
          }))
      : [],
  };
}

function parseKeyLevels(raw: unknown): KeyLevelDisplay[] {
  if (!Array.isArray(raw)) return [];
  const out: KeyLevelDisplay[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const role = typeof row.role === "string" ? row.role.trim() : "";
    const source = typeof row.source === "string" ? row.source.trim() : "";
    if (!role || !source) continue;
    const price = typeof row.price === "number" && Number.isFinite(row.price) ? row.price : undefined;
    let range: [number, number] | undefined;
    if (Array.isArray(row.range) && row.range.length === 2) {
      const lo = Number(row.range[0]);
      const hi = Number(row.range[1]);
      if (Number.isFinite(lo) && Number.isFinite(hi)) {
        range = [Math.min(lo, hi), Math.max(lo, hi)];
      }
    }
    if (price == null && !range) continue;
    out.push({ role, source, price, range });
  }
  return out;
}

/** v2 verdict → ordered section blocks (no prose splitting). */
export function buildVerdictSections(
  verdict: Record<string, unknown> | undefined,
  dataMode: LargeCapDataMode
): VerdictSectionBlock[] {
  if (!verdict || !isV2Verdict(verdict)) return [];

  const sections: VerdictSectionBlock[] = [];

  const bp = typeof verdict.big_picture === "string" ? verdict.big_picture.trim() : "";
  if (bp) {
    sections.push({ kind: "text", id: "big_picture", title: "Big Picture", body: bp });
  }

  const ra = verdict.recent_action;
  if (Array.isArray(ra) && ra.length > 0) {
    sections.push({
      kind: "bullets",
      id: "recent_action",
      title: "Recent Action",
      items: ra.map((s) => capitalizeBulletStart(String(s))).filter(Boolean),
    });
  }

  const pm = verdict.pre_market;
  if (dataMode === "historical_premarket" && Array.isArray(pm) && pm.length > 0) {
    sections.push({
      kind: "bullets",
      id: "pre_market",
      title: "Pre-Market",
      items: pm.map((s) => capitalizeBulletStart(String(s))).filter(Boolean),
    });
  }

  const comps = parseComps(verdict.comps);
  if (comps) {
    sections.push({
      kind: "comps",
      id: "comps",
      title: formatCompsSectionTitle(comps.total),
      comps,
    });
  }

  const levels = parseKeyLevels(verdict.key_levels);
  if (levels.length > 0) {
    sections.push({ kind: "levels", id: "key_levels", title: "Key Levels", levels });
  }

  return sections;
}

function scenarioLevelField(sc: Record<string, unknown>, field: string): unknown {
  if (sc[field] != null) return sc[field];
  const kl = sc.key_levels;
  if (!kl || typeof kl !== "object") return undefined;
  const nested = kl as Record<string, unknown>;
  if (field === "stop") return nested.stop ?? nested.invalidation;
  return nested[field];
}

export type ScenarioLevelPart = { label: string; value: string };

export function scenarioLevelParts(sc: Record<string, unknown>): ScenarioLevelPart[] {
  const range = scenarioLevelField(sc, "range") ?? sc.range;
  if (Array.isArray(range) && range.length === 2) {
    const lo = Math.min(Number(range[0]), Number(range[1]));
    const hi = Math.max(Number(range[0]), Number(range[1]));
    if (Number.isFinite(lo) && Number.isFinite(hi)) {
      return [
        { label: "Range", value: `${formatMonoPrice(lo)} – ${formatMonoPrice(hi)}` },
        { label: "Break", value: `${formatMonoPrice(hi)} / ${formatMonoPrice(lo)}` },
      ];
    }
  }
  const parts: ScenarioLevelPart[] = [];
  const trigger = scenarioLevelField(sc, "trigger");
  const target = scenarioLevelField(sc, "target");
  const stop = scenarioLevelField(sc, "stop");
  if (trigger != null) parts.push({ label: "Trigger", value: formatMonoPrice(trigger) });
  if (target != null) parts.push({ label: "Target", value: formatMonoPrice(target) });
  if (stop != null) parts.push({ label: "Stop", value: formatMonoPrice(stop) });
  return parts;
}

export function formatScenarioLevelsLine(sc: Record<string, unknown>): string {
  return scenarioLevelParts(sc)
    .map((part) => `${part.label} ${part.value}`)
    .join(" · ");
}

export function scenarioLetter(sc: Record<string, unknown>, index: number): string {
  const label = typeof sc.label === "string" ? sc.label.trim().toUpperCase() : "";
  if (label === "A" || label === "B" || label === "C") return label;
  return ["A", "B", "C"][index] ?? String(index + 1);
}

export function compsSegmentWidths(comps: CompsDisplay): {
  followPct: number;
  reversalPct: number;
  flatPct: number;
} {
  if (comps.total <= 0) {
    return { followPct: 0, reversalPct: 0, flatPct: 100 };
  }
  const followPct = (comps.follow_through / comps.total) * 100;
  const reversalPct = (comps.reversal / comps.total) * 100;
  const flatPct = Math.max(0, 100 - followPct - reversalPct);
  return { followPct, reversalPct, flatPct };
}

export function outcomeLabel(outcome: string): string {
  if (outcome === "follow_through") return "Followed Through";
  if (outcome === "reversal") return "Reversed";
  return "Flat";
}

/** Section header for comps block, e.g. "Comps (16)". */
export function formatCompsSectionTitle(total: number): string {
  return `Comps (${total})`;
}

/** Single outcome cell for comps examples table, e.g. "Reversed +2.58%". */
export function formatCompsExampleOutcome(
  outcome: CompsDisplay["recent_examples"][0]["outcome"],
  outcome_pct: number
): string {
  return `${outcomeLabel(outcome)} ${formatSignedPct(outcome_pct)}`;
}

export type CompsCategoryKey = "follow_through" | "reversal" | "flat";

export type CompsCategoryDisplay = {
  key: CompsCategoryKey;
  label: string;
  count: number;
};

export function compsCategories(comps: CompsDisplay): CompsCategoryDisplay[] {
  return [
    { key: "follow_through", label: "Follow-through", count: comps.follow_through },
    { key: "reversal", label: "Reversal", count: comps.reversal },
    { key: "flat", label: "Flat", count: comps.flat },
  ];
}
