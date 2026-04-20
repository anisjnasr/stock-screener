import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import type { EconomicEventPublic, EconomicEventsResponse } from "@/types/economic-events";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function ymdInEt(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function addCalendarDaysYmd(ymd: string, delta: number): string {
  const [ys, ms, ds] = ymd.split("-");
  const y = Number(ys);
  const m = Number(ms);
  const d = Number(ds);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return ymd;
  const t = Date.UTC(y, m - 1, d + delta);
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function parseImpactList(raw: string | null): EconomicEventPublic["impact"][] | null {
  if (raw == null || raw.trim() === "") return null;
  const allowed = new Set(["High", "Medium", "Low"]);
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const out: EconomicEventPublic["impact"][] = [];
  for (const p of parts) {
    if (allowed.has(p)) out.push(p as EconomicEventPublic["impact"]);
  }
  return out.length ? out : null;
}

/**
 * Read economic calendar rows from Supabase (anon + RLS SELECT).
 * Query: `from`, `to` (YYYY-MM-DD, inclusive). Defaults: today ET through +6 days.
 * Optional `impact` — comma list e.g. `High` or `High,Medium`.
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

  let q = supabase
    .from("economic_events")
    .select("id, event_date, event_time_et, event_name, country, impact, forecast, previous, actual")
    .gte("event_date", from)
    .lte("event_date", to)
    .order("event_date", { ascending: true })
    .order("event_time_et", { ascending: true, nullsFirst: false });

  if (impactFilter) {
    q = q.in("impact", impactFilter);
  }

  const { data, error } = await q;

  if (error) {
    console.error("[economic-events]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const events = (data ?? []) as EconomicEventPublic[];
  const body: EconomicEventsResponse = { events, range: { from, to } };

  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "private, max-age=0, s-maxage=120, stale-while-revalidate=300",
    },
  });
}
