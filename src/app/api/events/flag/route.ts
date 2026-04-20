import { NextRequest, NextResponse } from "next/server";
import { ensureViewerKeyCookie } from "@/lib/calendar-flag-session";
import { getSupabaseService } from "@/lib/supabase";
import { parseCalendarFlagBody } from "@/types/calendar-event-flags";

/**
 * Record a per-viewer flag (hides row for this browser via GET filters on calendar APIs).
 * Sets HttpOnly `calendar_flags_session` cookie when absent.
 */
export async function POST(request: NextRequest) {
  const service = getSupabaseService();
  if (!service) {
    return NextResponse.json({ error: "Supabase service role not configured" }, { status: 503 });
  }

  let jsonBody: unknown;
  try {
    jsonBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = parseCalendarFlagBody(jsonBody);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { eventType, eventId, reason } = parsed.body;

  const table = eventType === "economic" ? "economic_events" : "market_events";
  const { data: exists, error: exErr } = await service.from(table).select("id").eq("id", eventId).maybeSingle();
  if (exErr) {
    console.error("[events/flag] lookup", exErr.message);
    return NextResponse.json({ error: exErr.message }, { status: 500 });
  }
  if (!exists) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const res = NextResponse.json({ ok: true as const });
  const viewerKey = ensureViewerKeyCookie(request, res);

  const { error: upErr } = await service.from("calendar_event_flags").upsert(
    {
      viewer_key: viewerKey,
      event_type: eventType,
      event_id: eventId,
      reason,
    },
    { onConflict: "viewer_key,event_type,event_id" }
  );

  if (upErr) {
    console.error("[events/flag] upsert", upErr.message);
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  return res;
}
