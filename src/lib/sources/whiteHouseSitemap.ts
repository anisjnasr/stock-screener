import { XMLParser } from "fast-xml-parser";
import type { MarketEventInsert, MarketImpact } from "@/types/market-events";

const UA = "StockStalker/1.0 (policy calendar)";

export const WH_POSTS_SITEMAP = "https://www.whitehouse.gov/wp-sitemap-posts-post-1.xml";

function titleFromUrl(loc: string): string {
  try {
    const u = new URL(loc);
    const parts = u.pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1] ?? "event";
    return decodeURIComponent(last)
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  } catch {
    return "White House item";
  }
}

function impactFromUrl(loc: string): MarketImpact {
  const l = loc.toLowerCase();
  if (l.includes("state-of-the-union")) return "High";
  if (l.includes("joint-press") || l.includes("press-conference")) return "High";
  if (l.includes("executive-order") || l.includes("presidential-memorandum")) return "Medium";
  if (l.includes("rally")) return "Low";
  return "Medium";
}

function ymdFromLastmod(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = iso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

export function parseWhiteHousePostsSitemapXml(xml: string, opts?: { maxDaysBack?: number }): MarketEventInsert[] {
  const maxDays = opts?.maxDaysBack ?? 45;
  const cutoff = Date.now() - maxDays * 86400_000;
  const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });
  const doc = parser.parse(xml) as Record<string, unknown>;
  const urlset = doc.urlset as Record<string, unknown> | undefined;
  const raw = urlset?.url;
  const list = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Array<{ loc?: string; lastmod?: string }>;

  const updatedAt = new Date().toISOString();
  const out: MarketEventInsert[] = [];

  for (const item of list) {
    const loc = item.loc?.trim();
    if (!loc || !loc.includes("whitehouse.gov")) continue;
    if (loc.endsWith("/news/") || loc.endsWith("/news")) continue;
    const path = (() => {
      try {
        return new URL(loc).pathname;
      } catch {
        return "";
      }
    })();
    if (!path.includes("/briefing-room/") && !path.includes("/presidential-actions/") && !path.includes("/articles/")) {
      continue;
    }

    const lm = item.lastmod?.trim();
    const t = lm ? Date.parse(lm) : NaN;
    if (Number.isFinite(t) && t < cutoff) continue;

    const event_date = ymdFromLastmod(lm) ?? new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());

    const event_title = titleFromUrl(loc);
    out.push({
      event_date,
      event_time_et: null,
      event_title,
      event_category: "white_house",
      speaker: null,
      location: "The White House",
      impact: impactFromUrl(loc),
      source_url: loc,
      source_type: "whitehouse_wp_sitemap",
      external_id: `wh:${slug(loc)}`,
      description: null,
      updated_at: updatedAt,
    });
  }

  return dedupeByExternal(out);
}

function slug(s: string): string {
  return s.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 140);
}

function dedupeByExternal(rows: MarketEventInsert[]): MarketEventInsert[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    const k = r.external_id ?? r.source_url ?? "";
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export async function fetchWhiteHousePostsSitemapXml(init?: { signal?: AbortSignal }): Promise<string> {
  const res = await fetch(WH_POSTS_SITEMAP, {
    signal: init?.signal,
    headers: { Accept: "application/xml,text/xml", "User-Agent": UA },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`White House sitemap HTTP ${res.status}`);
  return await res.text();
}
