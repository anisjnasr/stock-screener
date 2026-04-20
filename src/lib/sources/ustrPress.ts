import * as cheerio from "cheerio";
import type { MarketEventInsert } from "@/types/market-events";

const UA = "StockStalker/1.0 (policy calendar)";

const USTR_TRADE_KEYWORDS =
  /\b(tariff|trade|WTO|USMCA|export|import|sanction|sanctions|manufacturing|steel|aluminum|301|232|reciprocal|bilateral|multilateral|ministerial|USTR|Ambassador|Mexico|Canada|China|Japan|EU|UK|Philippines|Vietnam|India|Brazil|negotiat|agreement)\b/i;

const MONTH_MAP: Record<string, number> = {
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

/** Parse `/.../press-releases/2026/april/slug` → first day of month in ET calendar sense (stored as date). */
export function parseUstrPressPathDate(href: string): string | null {
  const m = /\/press-releases\/(\d{4})\/([a-z]+)\//i.exec(href);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = MONTH_MAP[m[2].toLowerCase()];
  if (!mo || !Number.isFinite(y)) return null;
  return `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-01`;
}

export function parseUstrPressListingHtml(html: string): MarketEventInsert[] {
  const $ = cheerio.load(html);
  const out: MarketEventInsert[] = [];
  const updatedAt = new Date().toISOString();

  $("div.views-row").each((_, row) => {
    const $row = $(row);
    const $a = $row.find(".views-field-title a").first();
    const href = $a.attr("href")?.trim() ?? "";
    const title = $a.text().trim();
    if (!href || !title) return;
    if (!href.includes("/press-releases/")) return;
    if (!USTR_TRADE_KEYWORDS.test(title)) return;
    if (/\/press-releases\/\d{4}\/?$/i.test(href)) return;

    const event_date = parseUstrPressPathDate(href);
    if (!event_date) return;

    const abs = href.startsWith("http") ? href : `https://ustr.gov${href}`;
    out.push({
      event_date,
      event_time_et: null,
      event_title: title,
      event_category: "ustr",
      speaker: null,
      location: null,
      impact: "High",
      source_url: abs,
      source_type: "ustr_press_listing",
      external_id: `ustr:${slug(href)}`,
      description: null,
      updated_at: updatedAt,
    });
  });

  return dedupeByExternal(out);
}

function slug(s: string): string {
  return s.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 140);
}

function dedupeByExternal(rows: MarketEventInsert[]): MarketEventInsert[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    const k = r.external_id ?? `${r.event_date}:${r.event_title}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export async function fetchUstrPressListingHtml(init?: { signal?: AbortSignal }): Promise<string> {
  const url = "https://ustr.gov/about-us/policy-offices/press-office/press-releases";
  const res = await fetch(url, {
    signal: init?.signal,
    headers: { Accept: "text/html", "User-Agent": UA },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`USTR press listing HTTP ${res.status}`);
  return await res.text();
}
