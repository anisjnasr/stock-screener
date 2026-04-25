"use client";

import { useCallback, useEffect, useState } from "react";
import EventRowFlag from "./EventRowFlag";
import { ymdInEt } from "@/lib/et-ymd";
import { industryThemePillClass } from "@/lib/premarket/industry-theme-pill-class";
import type { EconomicEventPublic, EconomicEventsResponse } from "@/types/economic-events";
import type { MarketEventPublic, MarketEventsResponse } from "@/types/market-events";

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

function ImpactDot({ impact }: { impact: string }) {
  const i = impact.toLowerCase();
  const cls = i === "high" ? "impact-high" : i === "medium" ? "impact-med" : "impact-low";
  return (
    <span className={cls} title={impact} aria-label={`Impact ${impact}`}>
      ●
    </span>
  );
}

function filterLow(impact: string): boolean {
  return impact.toLowerCase() !== "low";
}

function themePillLabel(themeTag: string | null | undefined): string {
  const tag = themeTag?.trim();
  if (!tag) return "Theme";
  return /\btheme$/i.test(tag) ? tag : `${tag} Theme`;
}

export default function EconomicCalendar() {
  const [econToday, setEconToday] = useState<EconomicEventPublic[]>([]);
  const [mktToday, setMktToday] = useState<MarketEventPublic[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const econQs = new URLSearchParams({ impact: "High,Medium" });
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
        setEconToday([]);
        setMktToday([]);
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
      const econ = econEvents
        .filter((ev) => ev.event_date === todayYmd && filterLow(ev.impact))
        .sort((a, b) => sortKeyFor(a.event_date, a.event_time_et).localeCompare(sortKeyFor(b.event_date, b.event_time_et)));
      const mkt = mktEvents
        .filter((ev) => ev.event_date === todayYmd && filterLow(ev.impact))
        .sort((a, b) => sortKeyFor(a.event_date, a.event_time_et).localeCompare(sortKeyFor(b.event_date, b.event_time_et)));

      setEconToday(econ);
      setMktToday(mkt);
    } catch (e) {
      setEconToday([]);
      setMktToday([]);
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const total = econToday.length + mktToday.length;

  if (loading) {
    return (
      <p className="pm-site-prose" style={{ color: "var(--text-secondary)" }}>
        Loading calendar…
      </p>
    );
  }

  if (error && total === 0) {
    return (
      <div className="space-y-2">
        <p className="pm-site-prose" style={{ color: "var(--text-secondary)" }}>
          {error}
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="pm-focus rounded border px-2 py-1 font-medium"
          style={{
            borderColor: "var(--border-default)",
            color: "var(--text-primary)",
            fontFamily: "var(--ws-font-sans)",
            fontSize: "var(--ws-fs-label)",
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (total === 0) {
    return (
      <div className="space-y-2">
        <p className="pm-site-prose" style={{ color: "var(--text-secondary)" }}>
          No economic or key events for today (ET). Run calendar crons to refresh.
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="pm-focus rounded border px-2 py-1 font-medium"
          style={{
            borderColor: "var(--border-default)",
            color: "var(--text-primary)",
            fontFamily: "var(--ws-font-sans)",
            fontSize: "var(--ws-fs-label)",
          }}
        >
          Refresh
        </button>
      </div>
    );
  }

  const tableHeadStyle = { borderBottom: "1px solid var(--border-default)", background: "var(--bg-inset)" } as const;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="min-w-0">
          <h3 className="pm-section-label mb-1" style={{ color: "var(--accent-cyan)" }}>
            Economic
          </h3>
          <div className="overflow-x-auto rounded border" style={{ borderColor: "var(--border-default)" }}>
            {econToday.length === 0 ? (
              <p className="pm-site-caption px-2 py-2" style={{ color: "var(--text-tertiary)" }}>
                No high-impact releases today.
              </p>
            ) : (
              <table className="w-full min-w-[18rem] border-collapse text-left">
                <thead>
                  <tr style={tableHeadStyle}>
                    <th className="pm-sip-col-head px-2 py-1" style={{ color: "var(--text-tertiary)" }}>
                      When
                    </th>
                    <th className="pm-sip-col-head px-2 py-1" style={{ color: "var(--text-tertiary)" }}>
                      Impact
                    </th>
                    <th className="pm-sip-col-head px-2 py-1" style={{ color: "var(--text-tertiary)" }}>
                      Event
                    </th>
                    <th className="pm-sip-col-head hidden px-2 py-1 sm:table-cell" style={{ color: "var(--text-tertiary)" }}>
                      Fcst
                    </th>
                    <th className="pm-sip-col-head hidden px-2 py-1 sm:table-cell" style={{ color: "var(--text-tertiary)" }}>
                      Act
                    </th>
                    <th className="pm-sip-col-head w-6 px-1 py-1 text-right" style={{ color: "var(--text-tertiary)" }}>
                      <span className="sr-only">Flag</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {econToday.map((row) => (
                    <tr key={row.id} className="border-t" style={{ borderColor: "var(--border-default)" }}>
                      <td
                        className="whitespace-nowrap px-2 py-1 align-top tabular-nums pm-mono"
                        style={{ color: "var(--text-primary)", fontSize: "var(--ws-fs-caption)" }}
                      >
                        {formatTimeEt(row.event_time_et)}
                      </td>
                      <td className="px-2 py-1 align-top">
                        <ImpactDot impact={row.impact} />
                      </td>
                      <td className="pm-site-prose px-2 py-1 align-top leading-snug" style={{ color: "var(--text-primary)" }}>
                        {row.event_name}
                        <span className="pm-site-caption mt-0.5 block sm:hidden" style={{ color: "var(--text-tertiary)" }}>
                          F {dash(row.forecast)} · A {dash(row.actual)}
                        </span>
                      </td>
                      <td className="pm-site-caption hidden whitespace-pre-wrap px-2 py-1 align-top sm:table-cell" style={{ color: "var(--text-secondary)" }}>
                        {dash(row.forecast)}
                      </td>
                      <td className="pm-site-caption hidden whitespace-pre-wrap px-2 py-1 align-top sm:table-cell" style={{ color: "var(--text-secondary)" }}>
                        {dash(row.actual)}
                      </td>
                      <td className="align-top">
                        <EventRowFlag
                          eventType="economic"
                          eventId={row.id}
                          onFlagged={() => setEconToday((prev) => prev.filter((r) => r.id !== row.id))}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="min-w-0">
          <h3 className="pm-section-label mb-1" style={{ color: "var(--accent-amber)" }}>
            Key events
          </h3>
          <div className="overflow-x-auto rounded border" style={{ borderColor: "var(--border-default)" }}>
            {mktToday.length === 0 ? (
              <p className="pm-site-caption px-2 py-2" style={{ color: "var(--text-tertiary)" }}>
                No key policy events today.
              </p>
            ) : (
              <table className="w-full min-w-[18rem] border-collapse text-left">
                <thead>
                  <tr style={tableHeadStyle}>
                    <th className="pm-sip-col-head px-2 py-1" style={{ color: "var(--text-tertiary)" }}>
                      When
                    </th>
                    <th className="pm-sip-col-head px-2 py-1" style={{ color: "var(--text-tertiary)" }}>
                      Impact
                    </th>
                    <th className="pm-sip-col-head px-2 py-1" style={{ color: "var(--text-tertiary)" }}>
                      Event
                    </th>
                    <th className="pm-sip-col-head w-6 px-1 py-1 text-right" style={{ color: "var(--text-tertiary)" }}>
                      <span className="sr-only">Flag</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {mktToday.map((row) => (
                    <tr key={row.id} className="border-t" style={{ borderColor: "var(--border-default)" }}>
                      <td
                        className="whitespace-nowrap px-2 py-1 align-top tabular-nums pm-mono"
                        style={{ color: "var(--text-primary)", fontSize: "var(--ws-fs-caption)" }}
                      >
                        {formatTimeEt(row.event_time_et)}
                      </td>
                      <td className="px-2 py-1 align-top">
                        <ImpactDot impact={row.impact} />
                      </td>
                      <td className="pm-site-prose px-2 py-1 align-top leading-snug" style={{ color: "var(--text-primary)" }}>
                        {row.source_url ? (
                          <a
                            href={row.source_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="pm-focus rounded underline-offset-2 hover:underline"
                            style={{ color: "var(--text-primary)" }}
                          >
                            {row.event_title}
                          </a>
                        ) : (
                          row.event_title
                        )}
                        {row.event_category === "theme_driven" ? (
                          <span
                            className={`pm-site-caption mt-0.5 ml-1 inline-block rounded border px-1.5 py-px font-semibold ${industryThemePillClass(row.theme_tag ?? "")}`}
                            title={row.theme_tag ? `Theme: ${row.theme_tag}` : "Theme-driven"}
                          >
                            {themePillLabel(row.theme_tag)}
                          </span>
                        ) : null}
                      </td>
                      <td className="align-top">
                        <EventRowFlag
                          eventType="market"
                          eventId={row.id}
                          onFlagged={() => setMktToday((prev) => prev.filter((r) => r.id !== row.id))}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      <div
        className="pm-site-caption flex flex-wrap items-center justify-end gap-2 border-t pt-2"
        style={{ borderColor: "var(--border-default)", color: "var(--text-tertiary)" }}
      >
        <button
          type="button"
          onClick={() => void load()}
          className="pm-focus rounded border px-2 py-1 font-medium"
          style={{
            borderColor: "var(--border-default)",
            color: "var(--text-secondary)",
            fontFamily: "var(--ws-font-sans)",
            fontSize: "var(--ws-fs-label)",
          }}
        >
          Refresh
        </button>
      </div>
    </div>
  );
}
