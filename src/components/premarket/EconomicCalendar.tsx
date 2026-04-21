"use client";

import { useCallback, useEffect, useState } from "react";
import EventRowFlag from "./EventRowFlag";
import { ymdInEt } from "@/lib/et-ymd";
import type { EconomicEventPublic, EconomicEventsResponse } from "@/types/economic-events";
import type { MarketEventPublic, MarketEventsResponse } from "@/types/market-events";

type CalendarKind = "economic" | "market";

type MergedCalendarRow = {
  kind: CalendarKind;
  id: string;
  sortKey: string;
  event_date: string;
  event_time_et: string | null;
  title: string;
  source_url: string | null;
  actual: string | null;
  forecast: string | null;
  previous: string | null;
};

function formatTimeEt(kind: CalendarKind, hms: string | null): string {
  if (!hms) return kind === "market" ? "All day" : "TBD";
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

function timeForSort(hms: string | null): string {
  if (!hms || !hms.includes(":")) return "00:00:00";
  const parts = hms.split(":");
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  const s = parts[2] != null ? Number(parts[2]) : 0;
  if (!Number.isFinite(h) || !Number.isFinite(m)) return "00:00:00";
  const sec = Number.isFinite(s) ? s : 0;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function sortKeyFor(date: string, time: string | null): string {
  return `${date}T${timeForSort(time)}`;
}

function toEconomicRows(events: EconomicEventPublic[]): MergedCalendarRow[] {
  return events.map((ev) => ({
    kind: "economic" as const,
    id: ev.id,
    sortKey: sortKeyFor(ev.event_date, ev.event_time_et),
    event_date: ev.event_date,
    event_time_et: ev.event_time_et,
    title: ev.event_name,
    source_url: null,
    actual: ev.actual,
    forecast: ev.forecast,
    previous: ev.previous,
  }));
}

function toMarketRows(events: MarketEventPublic[]): MergedCalendarRow[] {
  return events.map((ev) => ({
    kind: "market" as const,
    id: ev.id,
    sortKey: sortKeyFor(ev.event_date, ev.event_time_et),
    event_date: ev.event_date,
    event_time_et: ev.event_time_et,
    title: ev.event_title,
    source_url: ev.source_url,
    actual: null,
    forecast: null,
    previous: null,
  }));
}

function mergeSortToday(econ: EconomicEventPublic[], market: MarketEventPublic[], todayYmd: string): MergedCalendarRow[] {
  const rows = [...toEconomicRows(econ), ...toMarketRows(market)].filter((r) => r.event_date === todayYmd);
  rows.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  return rows;
}

export default function EconomicCalendar() {
  const [rows, setRows] = useState<MergedCalendarRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const econQs = new URLSearchParams({ impact: "High" });
      const mktQs = new URLSearchParams({ impact: "High,Medium" });
      const [eRes, mRes] = await Promise.all([
        fetch(`/api/economic-events?${econQs.toString()}`, { cache: "no-store" }),
        fetch(`/api/market-events?${mktQs.toString()}`, { cache: "no-store" }),
      ]);
      const eJson = (await eRes.json()) as EconomicEventsResponse & { error?: string };
      const mJson = (await mRes.json()) as MarketEventsResponse & { error?: string };

      const econOk = eRes.ok;
      const mktOk = mRes.ok;
      const econEvents = econOk ? eJson.events ?? [] : [];
      const mktEvents = mktOk ? mJson.events ?? [] : [];

      if (!econOk && !mktOk) {
        setRows(null);
        setError(eJson.error ?? mJson.error ?? "Failed to load calendar");
        return;
      }

      if (!econOk) {
        console.warn("[EconomicCalendar] economic-events:", eJson.error ?? eRes.statusText);
      }
      if (!mktOk) {
        console.warn("[EconomicCalendar] market-events:", mJson.error ?? mRes.statusText);
      }

      const todayYmd = ymdInEt();
      const merged = mergeSortToday(econEvents, mktEvents, todayYmd);
      setRows(merged);
    } catch (e) {
      setRows(null);
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
        Loading calendar…
      </p>
    );
  }

  if (error && !rows?.length) {
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

  if (!rows?.length) {
    return (
      <div className="space-y-2">
        <p className="text-sm leading-relaxed" style={{ color: "var(--ws-text-dim)" }}>
          No economic or policy events for today (ET). Run the calendar crons to refresh data.
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
                Actual
              </th>
              <th className="hidden px-2 py-1.5 font-semibold sm:table-cell" style={{ color: "var(--ws-text-dim)" }}>
                Forecast
              </th>
              <th className="hidden px-2 py-1.5 font-semibold sm:table-cell" style={{ color: "var(--ws-text-dim)" }}>
                Previous
              </th>
              <th className="w-8 px-1 py-1.5 text-right font-semibold" style={{ color: "var(--ws-text-dim)" }}>
                <span className="sr-only">Flag</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={`${row.kind}:${row.id}`}
                className="group border-t transition-colors hover:bg-[color:var(--ws-hover)]"
                style={{ borderColor: "var(--ws-border)" }}
              >
                <td className="whitespace-nowrap px-2 py-1.5 align-top tabular-nums" style={{ color: "var(--ws-text)" }}>
                  {formatTimeEt(row.kind, row.event_time_et)}
                </td>
                <td className="px-2 py-1.5 align-top" style={{ color: "var(--ws-text)" }}>
                  {row.source_url ? (
                    <a
                      href={row.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="leading-snug underline decoration-[color:var(--ws-border)] underline-offset-2 hover:decoration-[color:var(--ws-text)]"
                    >
                      {row.title}
                    </a>
                  ) : (
                    <span className="leading-snug">{row.title}</span>
                  )}
                  <span className="mt-0.5 block text-[11px] sm:hidden" style={{ color: "var(--ws-text-dim)" }}>
                    A {dash(row.actual)} · F {dash(row.forecast)} · P {dash(row.previous)}
                  </span>
                </td>
                <td className="hidden whitespace-pre-wrap px-2 py-1.5 align-top sm:table-cell" style={{ color: "var(--ws-text-dim)" }}>
                  {dash(row.actual)}
                </td>
                <td className="hidden whitespace-pre-wrap px-2 py-1.5 align-top sm:table-cell" style={{ color: "var(--ws-text-dim)" }}>
                  {dash(row.forecast)}
                </td>
                <td className="hidden whitespace-pre-wrap px-2 py-1.5 align-top sm:table-cell" style={{ color: "var(--ws-text-dim)" }}>
                  {dash(row.previous)}
                </td>
                <td className="w-8 align-top">
                  <EventRowFlag
                    eventType={row.kind === "economic" ? "economic" : "market"}
                    eventId={row.id}
                    onFlagged={() =>
                      setRows((prev) =>
                        prev ? prev.filter((r) => !(r.kind === row.kind && r.id === row.id)) : null
                      )
                    }
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
