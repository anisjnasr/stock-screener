export type CalendarEventFlagType = "economic" | "market";

/** Stored reason codes (map to spec labels in UI). */
export type CalendarFlagReason = "not_relevant" | "wrong_timing" | "duplicate" | "too_noisy";

export type CalendarFlagPostBody = {
  eventType: CalendarEventFlagType;
  eventId: string;
  reason: CalendarFlagReason;
};

export type CalendarFlagPostResult =
  | { ok: true; body: CalendarFlagPostBody }
  | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const REASONS = new Set<CalendarFlagReason>(["not_relevant", "wrong_timing", "duplicate", "too_noisy"]);
const TYPES = new Set<CalendarEventFlagType>(["economic", "market"]);

export function isUuid(s: string): boolean {
  return UUID_RE.test(s.trim());
}

/** Validate POST JSON for /api/events/flag (pure, for tests). */
export function parseCalendarFlagBody(body: unknown): CalendarFlagPostResult {
  if (body == null || typeof body !== "object") {
    return { ok: false, error: "Expected JSON object" };
  }
  const o = body as Record<string, unknown>;
  const eventType = o.eventType;
  const eventId = o.eventId;
  const reason = o.reason;
  if (typeof eventType !== "string" || !TYPES.has(eventType as CalendarEventFlagType)) {
    return { ok: false, error: "eventType must be \"economic\" or \"market\"" };
  }
  if (typeof eventId !== "string" || !isUuid(eventId)) {
    return { ok: false, error: "eventId must be a UUID" };
  }
  if (typeof reason !== "string" || !REASONS.has(reason as CalendarFlagReason)) {
    return { ok: false, error: "reason must be not_relevant | wrong_timing | duplicate | too_noisy" };
  }
  return {
    ok: true,
    body: {
      eventType: eventType as CalendarEventFlagType,
      eventId: eventId.trim(),
      reason: reason as CalendarFlagReason,
    },
  };
}
