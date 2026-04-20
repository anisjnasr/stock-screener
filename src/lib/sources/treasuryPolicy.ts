import * as cheerio from "cheerio";
import type { MarketEventInsert, MarketImpact } from "@/types/market-events";

const UA = "StockStalker/1.0 (policy calendar)";

export const TREASURY_ANNOUNCED_JSON =
  "https://www.treasurydirect.gov/TA_WS/securities/announced?format=json";

const PRESS_KEYWORDS =
  /\b(OFAC|sanction|sanctions|debt\s*ceiling|tariff|tariffs|Section\s*301|Section\s*232|export|import|WTO|USMCA|trade\s+war|Russia|Iran|China|forc(ed|ing)\s+labor)\b/i;

type AnnouncedRow = {
  cusip?: string;
  securityType?: string;
  securityTerm?: string;
  auctionDate?: string;
  closingTimeCompetitive?: string;
};

function auctionImpact(term: string): MarketImpact {
  const t = term.toLowerCase();
  if (t.includes("10-year") || t.includes("30-year") || t.includes("10 year") || t.includes("30 year")) {
    return "High";
  }
  return "Low";
}

function parseTreasuryClosingToHms(raw: string): string | null {
  const t = raw.replace(/\./g, "").trim().toUpperCase();
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/.exec(t);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ap = m[3];
  if (ap === "PM" && h < 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}:00`;
}

function ymdFromIsoDate(s: string | undefined): string | null {
  if (!s) return null;
  const d = s.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

export function parseTreasuryAnnouncedJson(jsonText: string): MarketEventInsert[] {
  const rows = JSON.parse(jsonText) as AnnouncedRow[];
  if (!Array.isArray(rows)) return [];
  const updatedAt = new Date().toISOString();
  const out: MarketEventInsert[] = [];
  for (const r of rows) {
    const event_date = ymdFromIsoDate(r.auctionDate);
    if (!event_date || !r.cusip) continue;
    const term = String(r.securityTerm ?? "").trim();
    const typ = String(r.securityType ?? "").trim();
    const title = `${term} ${typ} auction`.replace(/\s+/g, " ").trim();
    const hms = r.closingTimeCompetitive ? parseTreasuryClosingToHms(r.closingTimeCompetitive) : null;
    out.push({
      event_date,
      event_time_et: hms,
      event_title: title,
      event_category: "treasury_auction",
      speaker: null,
      location: null,
      impact: auctionImpact(term),
      source_url: TREASURY_ANNOUNCED_JSON,
      source_type: "treasury_direct_announced",
      external_id: `td:${r.cusip}:${event_date}`,
      description: null,
      updated_at: updatedAt,
    });
  }
  return out;
}

export async function fetchTreasuryAnnouncedJson(init?: { signal?: AbortSignal }): Promise<string> {
  const res = await fetch(TREASURY_ANNOUNCED_JSON, {
    signal: init?.signal,
    headers: { Accept: "application/json", "User-Agent": UA },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Treasury announced HTTP ${res.status}`);
  return await res.text();
}

/**
 * Parse Treasury press listing HTML (`/news/press-releases`).
 * Pairs `<time datetime>` immediately before `.news-title a`.
 */
export function parseTreasuryPressListingHtml(html: string): MarketEventInsert[] {
  const $ = cheerio.load(html);
  const out: MarketEventInsert[] = [];
  const updatedAt = new Date().toISOString();

  $("div.news-title").each((_, el) => {
    const $a = $(el).find("a").first();
    const href = $a.attr("href")?.trim() ?? "";
    const title = $a.text().trim();
    if (!title || !href.includes("/news/press-releases/")) return;
    if (!PRESS_KEYWORDS.test(title)) return;

    const $time = $(el).prev("time");
    const iso = $time.attr("datetime")?.trim();
    const event_date = iso ? iso.slice(0, 10) : null;
    if (!event_date) return;

    const absUrl = href.startsWith("http") ? href : `https://home.treasury.gov${href}`;
    const event_time_et = iso && iso.length > 10 ? utcIsoToEtTimeHms(iso) : null;

    out.push({
      event_date,
      event_time_et,
      event_title: title,
      event_category: "treasury_press",
      speaker: null,
      location: null,
      impact: "High",
      source_url: absUrl,
      source_type: "treasury_press_listing",
      external_id: `th:${slug(href)}`,
      description: null,
      updated_at: updatedAt,
    });
  });

  return out;
}

function slug(s: string): string {
  return s.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 120);
}

/** Convert UTC ISO instant to ET wall-clock time HH:mm:ss. */
function utcIsoToEtTimeHms(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const s = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(d);
  const m = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(s);
  if (!m) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}:${m[3]}`;
}

export async function fetchTreasuryPressReleasesHtml(init?: { signal?: AbortSignal }): Promise<string> {
  const url = "https://home.treasury.gov/news/press-releases";
  const res = await fetch(url, {
    signal: init?.signal,
    headers: { Accept: "text/html", "User-Agent": UA },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Treasury press listing HTTP ${res.status}`);
  return await res.text();
}
