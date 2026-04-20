import { describe, expect, it } from "vitest";
import { isUuid, parseCalendarFlagBody } from "./calendar-event-flags";

describe("parseCalendarFlagBody", () => {
  it("accepts valid payload", () => {
    const r = parseCalendarFlagBody({
      eventType: "economic",
      eventId: "550e8400-e29b-41d4-a716-446655440000",
      reason: "not_relevant",
    });
    expect(r).toEqual({
      ok: true,
      body: {
        eventType: "economic",
        eventId: "550e8400-e29b-41d4-a716-446655440000",
        reason: "not_relevant",
      },
    });
  });

  it("rejects bad eventType", () => {
    const r = parseCalendarFlagBody({
      eventType: "earnings",
      eventId: "550e8400-e29b-41d4-a716-446655440000",
      reason: "duplicate",
    });
    expect(r.ok).toBe(false);
  });

  it("rejects invalid uuid", () => {
    const r = parseCalendarFlagBody({
      eventType: "market",
      eventId: "not-a-uuid",
      reason: "too_noisy",
    });
    expect(r.ok).toBe(false);
  });

  it("rejects bad reason", () => {
    const r = parseCalendarFlagBody({
      eventType: "market",
      eventId: "550e8400-e29b-41d4-a716-446655440000",
      reason: "spam",
    });
    expect(r.ok).toBe(false);
  });
});

describe("isUuid", () => {
  it("matches standard lowercase uuid", () => {
    expect(isUuid("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
  });
});
