import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import type { NextRequest, NextResponse } from "next/server";
import { isUuid } from "@/types/calendar-event-flags";

/** HttpOnly session for per-viewer calendar hides (no JWT required). */
export const CALENDAR_FLAGS_COOKIE = "calendar_flags_session";

const COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 400; // ~13 months

export function readViewerKeyFromRequest(request: NextRequest): string | null {
  const raw = request.cookies.get(CALENDAR_FLAGS_COOKIE)?.value?.trim() ?? "";
  return isUuid(raw) ? raw : null;
}

/** Attach viewer cookie to response when missing or invalid. Returns the active viewer key. */
export function ensureViewerKeyCookie(request: NextRequest, response: NextResponse): string {
  const existing = readViewerKeyFromRequest(request);
  if (existing) return existing;
  const key = randomUUID();
  response.cookies.set(CALENDAR_FLAGS_COOKIE, key, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SEC,
    secure: process.env.NODE_ENV === "production",
  });
  return key;
}

export async function loadFlaggedEventIds(
  service: SupabaseClient,
  viewerKey: string,
  eventType: "economic" | "market"
): Promise<Set<string>> {
  const { data, error } = await service
    .from("calendar_event_flags")
    .select("event_id")
    .eq("viewer_key", viewerKey)
    .eq("event_type", eventType);

  if (error) {
    console.warn("[calendar_event_flags]", error.message);
    return new Set();
  }
  const out = new Set<string>();
  for (const row of data ?? []) {
    const id = (row as { event_id?: string }).event_id;
    if (id) out.add(String(id));
  }
  return out;
}
