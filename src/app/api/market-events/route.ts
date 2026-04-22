import { NextRequest, NextResponse } from "next/server";
import { loadFlaggedEventIds, readViewerKeyFromRequest } from "@/lib/calendar-flag-session";
import { addCalendarDaysYmd, ymdInEt } from "@/lib/et-ymd";
import { getSupabase, getSupabaseService } from "@/lib/supabase";
import type { MarketEventCategory, MarketEventPublic, MarketEventsResponse } from "@/types/market-events";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

const ALLOWED_CATEGORIES = new Set<MarketEventCategory>([
  "fomc",
  "fed_speech",
  "fed_testimony",
  "treasury_auction",
  "treasury_press",
  "white_house",
  "ustr",
  "theme_driven",
  "manual",
]);

function parseImpactList(raw: string | null): MarketEventPublic["impact"][] | null {
  if (raw == null || raw.trim() === "") return null;
  const allowed = new Set(["High", "Medium", "Low"]);
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const out: MarketEventPublic["impact"][] = [];
  for (const p of parts) {
    if (allowed.has(p)) out.push(p as MarketEventPublic["impact"]);
  }
  return out.length ? out : null;
}

function parseCategoryList(raw: string | null): MarketEventCategory[] | null {
  if (raw == null || raw.trim() === "") return null;
  const out: MarketEventCategory[] = [];
  for (const p of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    if (ALLOWED_CATEGORIES.has(p as MarketEventCategory)) out.push(p as MarketEventCategory);
  }
  return out.length ? out : null;
}

/**
 * Read `market_events` from Supabase (anon + RLS SELECT).
 * Query: `from`, `to` (YYYY-MM-DD, inclusive). Defaults: today ET through +6 days.
 * Optional `impact` — comma list. Optional `categories` — comma list of `event_category` values.
 */
export async function GET(request: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  let from = searchParams.get("from")?.trim() ?? "";
  let to = searchParams.get("to")?.trim() ?? "";
  if (!from) from = ymdInEt();
  if (!to) to = addCalendarDaysYmd(from, 6);
  if (!YMD.test(from) || !YMD.test(to)) {
    return NextResponse.json({ error: "Invalid from/to; use YYYY-MM-DD" }, { status: 400 });
  }
  if (from > to) {
    return NextResponse.json({ error: "`from` must be on or before `to`" }, { status: 400 });
  }

  const impactFilter = parseImpactList(searchParams.get("impact"));
  const categoryFilter = parseCategoryList(searchParams.get("categories"));

  let q = supabase
    .from("market_events")
    .select(
      "id, event_date, event_time_et, event_title, event_category, speaker, location, impact, source_url, source_type, description, theme_tag, theme_type, theme_rank"
    )
    .gte("event_date", from)
    .lte("event_date", to)
    .order("event_date", { ascending: true })
    .order("event_time_et", { ascending: true, nullsFirst: false });

  if (impactFilter) {
    q = q.in("impact", impactFilter);
  }
  if (categoryFilter) {
    q = q.in("event_category", categoryFilter);
  }

  const { data, error } = await q;

  if (error) {
    console.error("[market-events]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let events = (data ?? []) as MarketEventPublic[];
  const viewerKey = readViewerKeyFromRequest(request);
  if (viewerKey) {
    const svc = getSupabaseService();
    if (svc) {
      const hide = await loadFlaggedEventIds(svc, viewerKey, "market");
      events = events.filter((e) => !hide.has(e.id));
    }
  }

  const body: MarketEventsResponse = { events, range: { from, to } };

  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "private, max-age=0, stale-while-revalidate=120",
      Vary: "Cookie",
    },
  });
}
