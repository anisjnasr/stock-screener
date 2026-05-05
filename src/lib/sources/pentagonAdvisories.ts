import { XMLParser } from "fast-xml-parser";
import type { MarketEventInsert, MarketImpact } from "@/types/market-events";

const UA = "StockStalker/1.0 (policy calendar)";

// ContentType=2 is Defense.gov Advisories feed.
export const PENTAGON_ADVISORIES_RSS_URL =
  "https://www.defense.gov/DesktopModules/ArticleCS/RSS.ashx?ContentType=2&Site=945&max=50";

const PRESS_EVENT_KEYWORDS =
  /\b(press conference|press briefing|press gaggle|media availability|on-camera press|news conference|briefing)\b/i;

function parseRfc822ToEtDate(pubDate: string | undefined): string | null {
  if (!pubDate) return null;
  const d = new Date(pubDate);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function parseEtTimeToHms(raw: string): string | null {
  const m = /\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\s*(?:eastern|et|edt|est)?\b/i.exec(raw);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2] ?? "0");
  const ampm = m[3].toLowerCase();
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 1 || hour > 12 || minute < 0 || minute > 59) {
    return null;
  }
  if (ampm.startsWith("p") && hour < 12) hour += 12;
  if (ampm.startsWith("a") && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
}

function impactForText(text: string): MarketImpact {
  const t = text.toLowerCase();
  if (/\b(secretary of defense|secdef|joint chiefs|chairman)\b/.test(t)) return "High";
  return "Medium";
}

function slug(s: string): string {
  return s.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 140);
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function dedupeByExternal(rows: MarketEventInsert[]): MarketEventInsert[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    const k = r.external_id ?? `${r.event_date}:${r.event_title}`;
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

type RssItem = { title?: string; link?: string; description?: string; pubDate?: string };

export function parsePentagonAdvisoriesRss(xml: string): MarketEventInsert[] {
  const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });
  const doc = parser.parse(xml) as Record<string, unknown>;
  const channel = (doc.rss as { channel?: { item?: RssItem | RssItem[] } } | undefined)?.channel;
  const rawItems = channel?.item;
  const items = (Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : []) as RssItem[];
  const updatedAt = new Date().toISOString();
  const out: MarketEventInsert[] = [];

  for (const item of items) {
    const title = (item.title ?? "").trim();
    const link = (item.link ?? "").trim();
    const description = stripHtml((item.description ?? "").trim());
    if (!title || !link) continue;

    const combined = `${title} ${description}`;
    if (!PRESS_EVENT_KEYWORDS.test(combined)) continue;

    const event_date = parseRfc822ToEtDate(item.pubDate);
    if (!event_date) continue;

    const event_time_et = parseEtTimeToHms(combined);
    out.push({
      event_date,
      event_time_et,
      event_title: title,
      event_category: "pentagon_press",
      speaker: null,
      location: "The Pentagon",
      impact: impactForText(combined),
      source_url: link,
      source_type: "pentagon_advisories_rss",
      external_id: `pentagon:${slug(link)}`,
      description: description || null,
      updated_at: updatedAt,
    });
  }

  return dedupeByExternal(out);
}

export async function fetchPentagonAdvisoriesRss(init?: { signal?: AbortSignal }): Promise<string> {
  const res = await fetch(PENTAGON_ADVISORIES_RSS_URL, {
    signal: init?.signal,
    headers: { Accept: "application/rss+xml,application/xml,text/xml", "User-Agent": UA },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Pentagon advisories RSS HTTP ${res.status}`);
  return await res.text();
}
