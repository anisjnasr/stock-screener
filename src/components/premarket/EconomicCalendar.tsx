"use client";

import { useCallback, useEffect, useState } from "react";
import EventRowFlag from "./EventRowFlag";
import type { EconomicEventPublic, EconomicEventsResponse } from "@/types/economic-events";

function formatTimeEt(hms: string | null): string {
  if (!hms) return "TBD";
  const [hs, ms] = hms.split(":");
  const h = Number(hs);
  const m = Number(ms);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hms;
  const ap = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${ap} ET`;
}

function dash(v: string | null): string {
  if (v == null || v.trim() === "") return "—";
  return v;
}

export default function EconomicCalendar() {
  const [events, setEvents] = useState<EconomicEventPublic[] | null>(null);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ impact: "High" });
      const res = await fetch(`/api/economic-events?${qs.toString()}`, { cache: "no-store" });
      const json = (await res.json()) as EconomicEventsResponse & { error?: string };
      if (!res.ok) {
        setEvents(null);
        setRange(null);
        setError(json.error ?? res.statusText);
        return;
      }
      setEvents(json.events);
      setRange(json.range);
    } catch (e) {
      setEvents(null);
      setRange(null);
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <p className="text-sm leading-relaxed" style={{ color: "var(--ws-text-dim)" }}>
        Loading economic calendar…
      </p>
    );
  }

  if (error) {
    return (
      <div className="space-y-2">
        <p className="text-sm leading-relaxed" style={{ color: "var(--ws-text-dim)" }}>
          {error}
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded border px-2 py-1 text-xs font-medium uppercase tracking-wide transition-colors ws-focus-ring hover:bg-[color:var(--ws-hover)]"
          style={{ borderColor: "var(--ws-border)", color: "var(--ws-text)" }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!events?.length) {
    return (
      <div className="space-y-2">
        <p className="text-sm leading-relaxed" style={{ color: "var(--ws-text-dim)" }}>
          No high-impact US events in this range
          {range ? ` (${range.from} → ${range.to})` : ""}. Run the calendar cron to refresh data.
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded border px-2 py-1 text-xs font-medium uppercase tracking-wide transition-colors ws-focus-ring hover:bg-[color:var(--ws-hover)]"
          style={{ borderColor: "var(--ws-border)", color: "var(--ws-text)" }}
        >
          Refresh
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {range ? (
        <p className="text-[11px] uppercase tracking-wide" style={{ color: "var(--ws-text-dim)" }}>
          High impact · {range.from} → {range.to} · ET
        </p>
      ) : null}
      <div className="overflow-x-auto rounded border" style={{ borderColor: "var(--ws-border)" }}>
        <table className="w-full min-w-[28rem] border-collapse text-left text-xs">
          <thead>
            <tr style={{ borderBottom: "1px solid var(--ws-border)", background: "var(--ws-bg)" }}>
              <th className="px-2 py-1.5 font-semibold" style={{ color: "var(--ws-text-dim)" }}>
                When
              </th>
              <th className="px-2 py-1.5 font-semibold" style={{ color: "var(--ws-text-dim)" }}>
                Event
              </th>
              <th className="hidden px-2 py-1.5 font-semibold sm:table-cell" style={{ color: "var(--ws-text-dim)" }}>
                Fcst
              </th>
              <th className="hidden px-2 py-1.5 font-semibold sm:table-cell" style={{ color: "var(--ws-text-dim)" }}>
                Prev
              </th>
              <th className="hidden px-2 py-1.5 font-semibold md:table-cell" style={{ color: "var(--ws-text-dim)" }}>
                Act
              </th>
              <th className="w-8 px-1 py-1.5 text-right font-semibold" style={{ color: "var(--ws-text-dim)" }}>
                <span className="sr-only">Flag</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {events.map((ev) => (
              <tr
                key={ev.id}
                className="group border-t transition-colors hover:bg-[color:var(--ws-hover)]"
                style={{ borderColor: "var(--ws-border)" }}
              >
                <td className="whitespace-nowrap px-2 py-1.5 align-top tabular-nums" style={{ color: "var(--ws-text)" }}>
                  <span className="block text-[11px]" style={{ color: "var(--ws-text-dim)" }}>
                    {ev.event_date}
                  </span>
                  <span>{formatTimeEt(ev.event_time_et)}</span>
                </td>
                <td className="px-2 py-1.5 align-top" style={{ color: "var(--ws-text)" }}>
                  <span className="leading-snug">{ev.event_name}</span>
                  <span className="mt-0.5 block text-[11px] sm:hidden" style={{ color: "var(--ws-text-dim)" }}>
                    F {dash(ev.forecast)} · P {dash(ev.previous)}
                    {ev.actual != null && String(ev.actual).trim() !== "" ? ` · A ${dash(ev.actual)}` : ""}
                  </span>
                </td>
                <td className="hidden whitespace-pre-wrap px-2 py-1.5 align-top sm:table-cell" style={{ color: "var(--ws-text-dim)" }}>
                  {dash(ev.forecast)}
                </td>
                <td className="hidden whitespace-pre-wrap px-2 py-1.5 align-top sm:table-cell" style={{ color: "var(--ws-text-dim)" }}>
                  {dash(ev.previous)}
                </td>
                <td className="hidden whitespace-pre-wrap px-2 py-1.5 align-top md:table-cell" style={{ color: "var(--ws-text-dim)" }}>
                  {dash(ev.actual)}
                </td>
                <td className="w-8 align-top">
                  <EventRowFlag
                    eventType="economic"
                    eventId={ev.id}
                    onFlagged={() => setEvents((prev) => (prev ? prev.filter((r) => r.id !== ev.id) : null))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        onClick={() => void load()}
        className="rounded border px-2 py-1 text-[11px] font-medium uppercase tracking-wide transition-colors ws-focus-ring hover:bg-[color:var(--ws-hover)]"
        style={{ borderColor: "var(--ws-border)", color: "var(--ws-text-dim)" }}
      >
        Refresh
      </button>
    </div>
  );
}
