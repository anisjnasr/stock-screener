import * as cheerio from "cheerio";
import { parseFfTimeToHmsEt } from "@/lib/sources/forexFactoryCalendar";
import type { MarketEventCategory, MarketEventInsert, MarketImpact } from "@/types/market-events";

export const FED_CALENDAR_MONTHLY_BASE = "https://www.federalreserve.gov/newsevents";

const UA = "StockStalker/1.0 (economic+policy calendar; contact: local)";

function normalizeFedTime(raw: string): string | null {
  const t = raw.replace(/\./g, "").trim();
  return parseFfTimeToHmsEt(t);
}

function parseMonthHeading(text: string): { y: number; m: number } | null {
  const m = /^([A-Za-z]+)\s+(\d{4})$/.exec(text.trim());
  if (!m) return null;
  const monthNames: Record<string, number> = {
    january: 1,
    february: 2,
    march: 3,
    april: 4,
    may: 5,
    june: 6,
    july: 7,
    august: 8,
    september: 9,
    october: 10,
    november: 11,
    december: 12,
  };
  const mo = monthNames[m[1].toLowerCase()];
  const y = Number(m[2]);
  if (!mo || !Number.isFinite(y)) return null;
  return { y, m: mo };
}

function skipSection(name: string): boolean {
  const n = name.trim().toLowerCase();
  return n.includes("statistical release") || n === "beige book" || n.includes("conference");
}

function classifyFed(
  section: string,
  titleLine: string
): { category: MarketEventCategory; impact: MarketImpact } {
  const s = section.trim().toLowerCase();
  const t = titleLine.toLowerCase();

  if (s.includes("fomc") || t.includes("fomc")) {
    return { category: "fomc", impact: "High" };
  }
  if (t.includes("testimony")) {
    return { category: "fed_testimony", impact: "High" };
  }
  if (t.includes("powell") || t.includes("chair jerome") || (t.includes("chair") && t.includes("powell"))) {
    return { category: "fed_speech", impact: "High" };
  }
  if (t.includes("vice chair")) {
    return { category: "fed_speech", impact: "Medium" };
  }
  if (t.includes("governor")) {
    return { category: "fed_speech", impact: "Medium" };
  }
  if (/\bpresident\b/.test(t) && t.includes("federal reserve bank")) {
    return { category: "fed_speech", impact: "Low" };
  }
  return { category: "fed_speech", impact: "Medium" };
}

function slugId(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

/**
 * Parse one Federal Reserve monthly HTML calendar (`/newsevents/YYYY-MM.htm`).
 */
export function parseFedMonthlyCalendarHtml(html: string): MarketEventInsert[] {
  const $ = cheerio.load(html);
  const article = $("#article");
  if (!article.length) return [];

  const monthText = article.find(".row-title h4.text-center").first().text().trim();
  const ym = parseMonthHeading(monthText);
  if (!ym) return [];

  const out: MarketEventInsert[] = [];
  const updatedAt = new Date().toISOString();

  article.find("div.panel.panel-unstyled").each((_, panel) => {
    const $panel = $(panel);
    const sectionEl = $panel.prevAll("div.row.cal-nojs__rowTitle").first().find("h4");
    const section = sectionEl.text() || "";
    if (skipSection(section)) return;

    const row = $panel.find(".panel-body > .row").first();
    const timeText = row.find(".col-xs-2 p").first().text().trim();
    const dayText = row.find(".col-xs-3 p").first().text().trim();
    const col7 = row.find(".col-xs-7");
    const lines = col7
      .find("p")
      .toArray()
      .map((el) => $(el).text().trim())
      .filter(Boolean);
    const titleLine = lines[0] ?? "";
    const subtitle = col7.find("p.calendar__title em").first().text().trim();
    const locLine =
      lines.find((l) => l.startsWith("At ") || l.startsWith("at ")) ?? lines[lines.length - 1] ?? null;

    const day = parseInt(dayText.replace(/,/g, ""), 10);
    if (!Number.isFinite(day) || day < 1 || day > 31) return;

    const event_date = `${String(ym.y).padStart(4, "0")}-${String(ym.m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const event_time_et = normalizeFedTime(timeText);
    const { category, impact } = classifyFed(section, titleLine);
    const event_title = subtitle ? `${titleLine} — ${subtitle}` : titleLine;
    if (!event_title) return;

    const external_id = `fed:${event_date}:${category}:${slugId(titleLine)}`;

    out.push({
      event_date,
      event_time_et,
      event_title,
      event_category: category,
      speaker: titleLine || null,
      location: locLine,
      impact,
      source_url: `${FED_CALENDAR_MONTHLY_BASE}/${String(ym.y).padStart(4, "0")}-${String(ym.m).padStart(2, "0")}.htm`,
      source_type: "fed_calendar_monthly",
      external_id,
      description: subtitle || null,
      updated_at: updatedAt,
    });
  });

  return out;
}

/**
 * Fetches one Fed monthly calendar page. Returns `null` on HTTP 404 when that month
 * is not published yet (common for “next month” around month boundaries).
 */
export async function fetchFedMonthlyHtml(ymPath: string, init?: { signal?: AbortSignal }): Promise<string | null> {
  const url = `${FED_CALENDAR_MONTHLY_BASE}/${ymPath}.htm`;
  const res = await fetch(url, {
    signal: init?.signal,
    headers: { Accept: "text/html", "User-Agent": UA },
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Fed calendar HTTP ${res.status}: ${url}`);
  return await res.text();
}
