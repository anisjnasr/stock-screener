import { addCalendarDaysYmd, ymdInEt } from "@/lib/et-ymd";
import type { SupabaseClient } from "@supabase/supabase-js";

const FRED_OBS_URL = "https://api.stlouisfed.org/fred/series/observations";
const UA = "StockStalker/1.0 (FRED actuals; contact: local)";

/** Series that are index levels; we store YoY % in `economic_events.actual`. */
const YOY_LEVEL_SERIES = new Set(["CPIAUCSL", "CPILFESL", "PCEPILFE"]);

/** Retail sales total — level; we store MoM % . */
const MOM_LEVEL_SERIES = new Set(["RSAFS"]);

/** Total nonfarm employment level (thousands of persons); calendar “NFP” is MoM change in thousands. */
const PAYEMS_SERIES = "PAYEMS";

export type FredMappingRow = {
  event_name: string;
  fred_series_id: string;
  value_format: "percent" | "thousands" | "raw";
  release_offset_days: number;
};

type FredObservation = { date: string; value: string };

function getFredApiKey(): string {
  const k = process.env.FRED_API_KEY?.trim();
  if (!k) throw new Error("FRED_API_KEY is not set");
  return k;
}

export async function fetchFredObservations(
  seriesId: string,
  init: {
    observationStart: string;
    observationEnd: string;
    limit?: number;
    signal?: AbortSignal;
  }
): Promise<FredObservation[]> {
  const u = new URL(FRED_OBS_URL);
  u.searchParams.set("series_id", seriesId);
  u.searchParams.set("api_key", getFredApiKey());
  u.searchParams.set("file_type", "json");
  u.searchParams.set("sort_order", "desc");
  u.searchParams.set("observation_start", init.observationStart);
  u.searchParams.set("observation_end", init.observationEnd);
  u.searchParams.set("limit", String(init.limit ?? 24));

  const res = await fetch(u.toString(), {
    signal: init.signal,
    headers: { Accept: "application/json", "User-Agent": UA },
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`FRED ${seriesId} HTTP ${res.status}: ${text.slice(0, 200)}`);
  let data: { observations?: FredObservation[] };
  try {
    data = JSON.parse(text) as { observations?: FredObservation[] };
  } catch {
    throw new Error(`FRED ${seriesId}: invalid JSON`);
  }
  return Array.isArray(data.observations) ? data.observations : [];
}

function validNumericObs(obs: FredObservation[]): { date: string; v: number }[] {
  const out: { date: string; v: number }[] = [];
  for (const o of obs) {
    if (o.value === "." || o.value === "") continue;
    const v = Number(o.value);
    if (!Number.isFinite(v)) continue;
    out.push({ date: o.date.slice(0, 10), v });
  }
  return out;
}

/** Latest observation on or before `graceEndYmd` (YYYY-MM-DD). */
export function pickLatestOnOrBefore(
  obs: FredObservation[],
  graceEndYmd: string
): { date: string; v: number } | null {
  const rows = validNumericObs(obs).sort((a, b) => b.date.localeCompare(a.date));
  for (const r of rows) {
    if (r.date <= graceEndYmd) return r;
  }
  return null;
}

export function computeMonthlyYoYPercent(obs: FredObservation[], anchorEventYmd: string): number | null {
  const graceEnd = addCalendarDaysYmd(anchorEventYmd, 14);
  const rows = validNumericObs(obs).sort((a, b) => b.date.localeCompare(a.date));
  let ai = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].date <= graceEnd) {
      ai = i;
      break;
    }
  }
  if (ai < 0 || ai + 12 >= rows.length) return null;
  const cur = rows[ai].v;
  const yrAgo = rows[ai + 12].v;
  if (Math.abs(yrAgo) < 1e-12) return null;
  return ((cur - yrAgo) / yrAgo) * 100;
}

export function computeMonthlyMomPercent(obs: FredObservation[], anchorEventYmd: string): number | null {
  const graceEnd = addCalendarDaysYmd(anchorEventYmd, 14);
  const rows = validNumericObs(obs).sort((a, b) => b.date.localeCompare(a.date));
  let ai = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].date <= graceEnd) {
      ai = i;
      break;
    }
  }
  if (ai < 0 || ai + 1 >= rows.length) return null;
  const cur = rows[ai].v;
  const prev = rows[ai + 1].v;
  if (Math.abs(prev) < 1e-12) return null;
  return ((cur - prev) / prev) * 100;
}

/** PAYEMS month-over-month change, both in FRED “thousands of persons” units → headline “180K” style. */
export function computePayrollsChangeThousands(obs: FredObservation[], anchorEventYmd: string): number | null {
  const graceEnd = addCalendarDaysYmd(anchorEventYmd, 14);
  const rows = validNumericObs(obs).sort((a, b) => b.date.localeCompare(a.date));
  let ai = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].date <= graceEnd) {
      ai = i;
      break;
    }
  }
  if (ai < 0 || ai + 1 >= rows.length) return null;
  return rows[ai].v - rows[ai + 1].v;
}

export function formatActualForDisplay(
  seriesId: string,
  valueFormat: FredMappingRow["value_format"],
  rawValue: number
): string {
  if (YOY_LEVEL_SERIES.has(seriesId) || MOM_LEVEL_SERIES.has(seriesId)) {
    return `${rawValue.toFixed(1)}%`;
  }
  if (seriesId === PAYEMS_SERIES) {
    return `${Math.round(rawValue)}K`;
  }
  if (seriesId === "ICSA") {
    const k = rawValue / 1000;
    return `${k >= 10 ? k.toFixed(0) : k.toFixed(1)}K`;
  }
  if (valueFormat === "thousands") {
    return `${Math.round(rawValue)}K`;
  }
  if (valueFormat === "percent") {
    return `${rawValue.toFixed(1)}%`;
  }
  if (valueFormat === "raw") {
    if (Number.isInteger(rawValue) || Math.abs(rawValue - Math.round(rawValue)) < 0.05) return String(Math.round(rawValue));
    return rawValue.toFixed(1);
  }
  return String(rawValue);
}

async function resolveActualString(
  seriesId: string,
  valueFormat: FredMappingRow["value_format"],
  anchorEventYmd: string,
  signal?: AbortSignal
): Promise<string | null> {
  const end = addCalendarDaysYmd(anchorEventYmd, 21);
  const start = addCalendarDaysYmd(anchorEventYmd, -800);
  const obs = await fetchFredObservations(seriesId, {
    observationStart: start,
    observationEnd: end,
    limit:
      seriesId === PAYEMS_SERIES || YOY_LEVEL_SERIES.has(seriesId)
        ? 36
        : MOM_LEVEL_SERIES.has(seriesId)
          ? 8
          : seriesId === "A191RL1Q225SBEA"
            ? 16
            : 24,
    signal,
  });

  if (seriesId === PAYEMS_SERIES) {
    const ch = computePayrollsChangeThousands(obs, anchorEventYmd);
    if (ch == null) return null;
    return formatActualForDisplay(seriesId, valueFormat, ch);
  }

  if (YOY_LEVEL_SERIES.has(seriesId)) {
    const yoy = computeMonthlyYoYPercent(obs, anchorEventYmd);
    if (yoy == null) return null;
    return formatActualForDisplay(seriesId, valueFormat, yoy);
  }
  if (MOM_LEVEL_SERIES.has(seriesId)) {
    const mom = computeMonthlyMomPercent(obs, anchorEventYmd);
    if (mom == null) return null;
    return formatActualForDisplay(seriesId, valueFormat, mom);
  }

  const graceEnd = addCalendarDaysYmd(anchorEventYmd, 14);
  const picked = pickLatestOnOrBefore(obs, graceEnd);
  if (!picked) return null;

  let numeric = picked.v;
  if (seriesId === "ICSA") {
    // FRED ICSA is persons; display as thousands-style "224K"
    return formatActualForDisplay(seriesId, "thousands", numeric);
  }

  return formatActualForDisplay(seriesId, valueFormat, numeric);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Aborted"));
      return;
    }
    const t = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new Error("Aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Backfill `economic_events.actual` from FRED for mapped US rows with null actual and event_date on/before today ET.
 */
export async function runFredActualsBackfill(
  supabase: SupabaseClient,
  init?: { signal?: AbortSignal; todayYmd?: string }
): Promise<{ examined: number; updated: number; skipped: number; errors: string[] }> {
  const todayYmd = init?.todayYmd ?? ymdInEt();
  const errors: string[] = [];
  let examined = 0;
  let updated = 0;
  let skipped = 0;

  const { data: mappings, error: mapErr } = await supabase.from("fred_event_mapping").select("*");
  if (mapErr) {
    errors.push(`fred_event_mapping: ${mapErr.message}`);
    return { examined: 0, updated: 0, skipped: 0, errors };
  }
  const mapByName = new Map<string, FredMappingRow>();
  for (const row of mappings ?? []) {
    const r = row as FredMappingRow;
    if (r.event_name) mapByName.set(r.event_name, r);
  }
  if (mapByName.size === 0) {
    errors.push("fred_event_mapping is empty — run data/supabase-fred-event-mapping.sql");
    return { examined: 0, updated: 0, skipped: 0, errors };
  }

  const mappedNames = [...mapByName.keys()];
  const windowStart = addCalendarDaysYmd(todayYmd, -120);
  const { data: events, error: evErr } = await supabase
    .from("economic_events")
    .select("id, event_date, event_name, actual")
    .eq("country", "US")
    .gte("event_date", windowStart)
    .lte("event_date", todayYmd)
    .in("event_name", mappedNames);

  if (evErr) {
    errors.push(`economic_events: ${evErr.message}`);
    return { examined: 0, updated: 0, skipped: 0, errors };
  }

  const pending = (events ?? []).filter((e) => {
    const a = (e as { actual?: string | null }).actual;
    return a == null || String(a).trim() === "";
  });

  for (const raw of pending) {
    const ev = raw as { id: string; event_date: string; event_name: string; actual?: string | null };
    const mapping = mapByName.get(ev.event_name);
    if (!mapping) {
      skipped += 1;
      continue;
    }
    examined += 1;
    const anchor = addCalendarDaysYmd(String(ev.event_date).slice(0, 10), mapping.release_offset_days ?? 0);

    try {
      const actualStr = await resolveActualString(
        mapping.fred_series_id,
        mapping.value_format,
        anchor,
        init?.signal
      );
      if (!actualStr) {
        skipped += 1;
        await sleep(120, init?.signal);
        continue;
      }

      const { error: upErr } = await supabase
        .from("economic_events")
        .update({ actual: actualStr, updated_at: new Date().toISOString() })
        .eq("id", ev.id);

      if (upErr) {
        errors.push(`${ev.event_name} ${ev.event_date}: ${upErr.message}`);
      } else {
        updated += 1;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${ev.event_name} (${mapping.fred_series_id}): ${msg}`);
    }

    await sleep(120, init?.signal);
  }

  return { examined, updated, skipped, errors };
}
