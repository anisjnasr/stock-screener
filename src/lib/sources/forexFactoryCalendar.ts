import { XMLParser } from "fast-xml-parser";
import { DateTime } from "luxon";

/** Public weekly calendar mirror used by many dashboards (not official Forex Factory). */
export const FOREX_FACTORY_WEEKLY_XML_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.xml";

export type EconomicEventInsert = {
  event_date: string;
  event_time_et: string | null;
  event_name: string;
  country: string;
  impact: "High" | "Medium" | "Low";
  forecast: string | null;
  previous: string | null;
  /** Omit on upsert so an existing `actual` value is not wiped on refresh. */
  actual?: string | null;
  source: "forex_factory";
  external_id: string | null;
  updated_at: string;
};

function textOf(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "object" && v !== null && "#text" in (v as Record<string, unknown>)) {
    return String((v as Record<string, unknown>)["#text"]).trim();
  }
  return String(v).trim();
}

function toEventArray(eventField: unknown): Record<string, unknown>[] {
  if (eventField == null) return [];
  if (Array.isArray(eventField)) return eventField.filter((x) => x && typeof x === "object") as Record<string, unknown>[];
  if (typeof eventField === "object") return [eventField as Record<string, unknown>];
  return [];
}

/** MM-DD-YYYY (feed) -> YYYY-MM-DD */
export function parseFfAmericanDateToIso(mmddyyyy: string): string | null {
  const s = mmddyyyy.trim();
  const m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(s);
  if (!m) return null;
  const mo = Number(m[1]);
  const d = Number(m[2]);
  const y = Number(m[3]);
  if (!Number.isFinite(mo) || !Number.isFinite(d) || !Number.isFinite(y)) return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Parse Forex Factory-style time strings (e.g. "8:30am", "12:15pm") to Postgres TIME "HH:mm:ss".
 * Returns null for all-day / tentative / unknown.
 */
export function parseFfTimeToHmsEt(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  if (!t) return null;
  if (t === "n/a" || t === "tentative" || t === "all day" || t === "—" || t === "-") return null;
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/.exec(t.replace(/\./g, ""));
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;
  const ap = m[3];
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute > 59) return null;
  if (ap === "pm" && hour < 12) hour += 12;
  if (ap === "am" && hour === 12) hour = 0;
  if (hour > 23) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
}

function utcDateTimeToEt(dateIso: string, hmsUtc: string): { event_date: string; event_time_et: string } | null {
  const dtUtc = DateTime.fromFormat(`${dateIso} ${hmsUtc}`, "yyyy-MM-dd HH:mm:ss", { zone: "UTC" });
  if (!dtUtc.isValid) return null;
  const dtEt = dtUtc.setZone("America/New_York");
  return {
    event_date: dtEt.toFormat("yyyy-MM-dd"),
    event_time_et: dtEt.toFormat("HH:mm:ss"),
  };
}

function normalizeImpact(raw: string): "High" | "Medium" | "Low" | null {
  const s = raw.trim().toLowerCase();
  if (s === "high") return "High";
  if (s === "medium") return "Medium";
  if (s === "low") return "Low";
  return null;
}

function stableExternalId(eventDate: string, eventName: string): string {
  const slug = eventName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return `ff:${eventDate}:${slug}`;
}

function findWeeklyContainer(root: Record<string, unknown>): Record<string, unknown> | null {
  if (!root || typeof root !== "object") return null;
  const w =
    (root.weeklyevents as Record<string, unknown> | undefined) ??
    (root.weeklyEvents as Record<string, unknown> | undefined);
  if (w && typeof w === "object") return w;
  for (const v of Object.values(root)) {
    if (v && typeof v === "object" && "event" in (v as object)) return v as Record<string, unknown>;
  }
  return null;
}

export async function fetchForexFactoryCalendarXml(init?: { signal?: AbortSignal }): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25_000);
  const linked = init?.signal;
  if (linked) {
    if (linked.aborted) {
      clearTimeout(t);
      throw new DOMException("Aborted", "AbortError");
    }
    linked.addEventListener("abort", () => ctrl.abort(), { once: true });
  }
  try {
    const res = await fetch(FOREX_FACTORY_WEEKLY_XML_URL, {
      signal: ctrl.signal,
      headers: { Accept: "application/xml,text/xml,*/*" },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`Forex Factory calendar HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

/**
 * Parse weekly XML; keep **USD** + **High** or **Medium** impact (pre-market spec).
 * Feed times are UTC wall-clock values and are normalized to ET before upsert.
 */
export function parseForexFactoryHighMediumImpactUsd(xml: string): EconomicEventInsert[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    trimValues: true,
  });
  let root: Record<string, unknown>;
  try {
    root = parser.parse(xml) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`Forex Factory XML parse error: ${e instanceof Error ? e.message : String(e)}`);
  }

  const weekly = findWeeklyContainer(root);
  if (!weekly) return [];

  const events = toEventArray(weekly.event);
  const nowIso = new Date().toISOString();
  const out: EconomicEventInsert[] = [];

  for (const ev of events) {
    const countryRaw = textOf(ev.country ?? ev.currency).toUpperCase();
    if (countryRaw !== "USD") continue;

    const impact = normalizeImpact(textOf(ev.impact));
    if (impact !== "High" && impact !== "Medium") continue;

    const eventName = textOf(ev.title ?? ev.event);
    if (!eventName) continue;

    const dateRaw = textOf(ev.date);
    const eventDate = parseFfAmericanDateToIso(dateRaw);
    if (!eventDate) continue;

    const timeRaw = textOf(ev.time);
    const timeHmsRaw = parseFfTimeToHmsEt(timeRaw);
    const normalizedEt = timeHmsRaw ? utcDateTimeToEt(eventDate, timeHmsRaw) : null;
    const eventDateEt = normalizedEt?.event_date ?? eventDate;
    const eventTimeEt = normalizedEt?.event_time_et ?? null;

    const forecast = textOf(ev.forecast) || null;
    const previous = textOf(ev.previous) || null;

    out.push({
      event_date: eventDateEt,
      event_time_et: eventTimeEt,
      event_name: eventName,
      country: "US",
      impact,
      forecast,
      previous,
      source: "forex_factory",
      external_id: stableExternalId(eventDateEt, eventName),
      updated_at: nowIso,
    });
  }

  return out;
}
