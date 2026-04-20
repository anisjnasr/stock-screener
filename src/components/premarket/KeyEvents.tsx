"use client";

import { useCallback, useEffect, useState } from "react";
import type { MarketEventPublic, MarketEventsResponse } from "@/types/market-events";

function formatTimeEt(hms: string | null): string {
  if (!hms) return "All day";
  const [hs, ms] = hms.split(":");
  const h = Number(hs);
  const m = Number(ms);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hms;
  const ap = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${ap} ET`;
}

function categoryLabel(cat: string): string {
  return cat.replace(/_/g, " ");
}

export default function KeyEvents() {
  const [events, setEvents] = useState<MarketEventPublic[] | null>(null);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ impact: "High,Medium" });
      const res = await fetch(`/api/market-events?${qs.toString()}`, { cache: "no-store" });
      const json = (await res.json()) as MarketEventsResponse & { error?: string };
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
        Loading policy & Fed calendar…
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
          No Fed / Treasury / White House / USTR events in this range
          {range ? ` (${range.from} → ${range.to})` : ""}. After applying `data/supabase-market-events.sql`, run the
          market-events crons to populate data.
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
          High & medium · {range.from} → {range.to} · ET
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
                Type
              </th>
            </tr>
          </thead>
          <tbody>
            {events.map((ev) => (
              <tr
                key={ev.id}
                className="border-t transition-colors hover:bg-[color:var(--ws-hover)]"
                style={{ borderColor: "var(--ws-border)" }}
              >
                <td className="whitespace-nowrap px-2 py-1.5 align-top tabular-nums" style={{ color: "var(--ws-text)" }}>
                  <span className="block text-[11px]" style={{ color: "var(--ws-text-dim)" }}>
                    {ev.event_date}
                  </span>
                  <span>{formatTimeEt(ev.event_time_et)}</span>
                </td>
                <td className="px-2 py-1.5 align-top" style={{ color: "var(--ws-text)" }}>
                  {ev.source_url ? (
                    <a
                      href={ev.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="leading-snug underline decoration-[color:var(--ws-border)] underline-offset-2 hover:decoration-[color:var(--ws-text)]"
                    >
                      {ev.event_title}
                    </a>
                  ) : (
                    <span className="leading-snug">{ev.event_title}</span>
                  )}
                  <span className="mt-0.5 block text-[11px] sm:hidden" style={{ color: "var(--ws-text-dim)" }}>
                    {categoryLabel(ev.event_category)}
                  </span>
                </td>
                <td className="hidden whitespace-nowrap px-2 py-1.5 align-top capitalize sm:table-cell" style={{ color: "var(--ws-text-dim)" }}>
                  {categoryLabel(ev.event_category)}
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
