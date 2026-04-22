"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DateTime } from "luxon";
import { ymdInEt } from "@/lib/et-ymd";
import { gapperFilterStateToRequestBody, type GapperFilterState } from "@/components/premarket/gapper-filters-storage";
import { deriveMacroPeekKeywords } from "@/lib/premarket/macro-peek-derive";
import type { DailyEquitiesWriteupRow, DailyMacroWriteupRow } from "@/types/newsletter-macro";
import type { EconomicEventsResponse } from "@/types/economic-events";
import type { MarketEventsResponse } from "@/types/market-events";
import type { EarningsCalendarResponse } from "@/types/earnings-calendar";
import type { GappersResponse } from "@/types/gappers";
import type { StocksInPlaySuccess } from "@/types/stocks-in-play";

export type PremarketPeeks = {
  context: string;
  sip: string;
  calendars: string;
  earnings: string;
  movers: string;
};

type MacroApi = { ok: true; ymd: string; row: DailyMacroWriteupRow | null } | { ok: false; error: string };

type EquitiesApi =
  | {
      ok: true;
      ymd: string;
      row: DailyEquitiesWriteupRow | null;
      setupRequired?: boolean;
      setupMessage?: string;
    }
  | { ok: false; error: string };

function formatTopTickersDashed(tickers: string[], max = 5): string {
  const u = [...new Set(tickers.map((t) => t.trim().toUpperCase()).filter(Boolean))];
  const top = u.slice(0, max);
  if (!top.length) return "No tickers";
  return top.join(" - ");
}

/** Top tickers by gap % desc (dedupe keeps first/highest gap). */
function topTickersByGapPct(rows: { ticker: string; gapPct: number }[], max = 5): string[] {
  const sorted = [...rows].sort((a, b) => {
    const d = b.gapPct - a.gapPct;
    if (d !== 0) return d;
    return a.ticker.localeCompare(b.ticker);
  });
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of sorted) {
    const t = r.ticker.trim().toUpperCase();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

async function fetchCalendarCountToday(): Promise<number> {
  const todayYmd = ymdInEt();
  const econQs = new URLSearchParams({ impact: "High" });
  const mktQs = new URLSearchParams({ impact: "High,Medium" });
  const [eRes, mRes] = await Promise.all([
    fetch(`/api/economic-events?${econQs.toString()}`, { cache: "no-store" }),
    fetch(`/api/market-events?${mktQs.toString()}`, { cache: "no-store" }),
  ]);
  const eJson = (await eRes.json()) as EconomicEventsResponse & { error?: string };
  const mJson = (await mRes.json()) as MarketEventsResponse & { error?: string };
  const econ = eRes.ok ? eJson.events ?? [] : [];
  const mkt = mRes.ok ? mJson.events ?? [] : [];
  const nE = econ.filter((ev) => ev.event_date === todayYmd).length;
  const nM = mkt.filter((ev) => ev.event_date === todayYmd).length;
  return nE + nM;
}

export function usePremarketPeeks(gapperFilters: GapperFilterState, filtersHydrated: boolean) {
  const [macroRow, setMacroRow] = useState<DailyMacroWriteupRow | null>(null);
  const [macroYmd, setMacroYmd] = useState<string | null>(null);
  const [macroLoading, setMacroLoading] = useState(true);
  const [macroError, setMacroError] = useState<string | null>(null);

  const [equitiesRow, setEquitiesRow] = useState<DailyEquitiesWriteupRow | null>(null);
  const [equitiesYmd, setEquitiesYmd] = useState<string | null>(null);
  const [equitiesLoading, setEquitiesLoading] = useState(true);
  const [equitiesError, setEquitiesError] = useState<string | null>(null);
  const [equitiesSetupHint, setEquitiesSetupHint] = useState<string | null>(null);

  const [calendarPeek, setCalendarPeek] = useState("…");
  const [earningsPeek, setEarningsPeek] = useState("…");
  const [moversPeek, setMoversPeek] = useState("…");
  const [sipPeek, setSipPeek] = useState("…");

  const lastScheduledSlotRef = useRef<string | null>(null);
  const gapperBody = useMemo(() => gapperFilterStateToRequestBody(gapperFilters), [gapperFilters]);

  const loadMacro = useCallback(async () => {
    setMacroLoading(true);
    setMacroError(null);
    try {
      const res = await fetch("/api/premarket/macro-writeup", { cache: "no-store" });
      const json = (await res.json()) as MacroApi;
      if (!res.ok || !json.ok) {
        setMacroRow(null);
        setMacroYmd(null);
        setMacroError(!json.ok ? json.error : res.statusText);
        return;
      }
      setMacroYmd(json.ymd);
      setMacroRow(json.row);
    } catch (e) {
      setMacroRow(null);
      setMacroYmd(null);
      setMacroError(e instanceof Error ? e.message : "Failed to load macro writeup");
    } finally {
      setMacroLoading(false);
    }
  }, []);

  const loadEquities = useCallback(async () => {
    setEquitiesLoading(true);
    setEquitiesError(null);
    setEquitiesSetupHint(null);
    try {
      const res = await fetch("/api/premarket/equities-writeup", { cache: "no-store" });
      const json = (await res.json()) as EquitiesApi;
      if (!res.ok || !json.ok) {
        setEquitiesRow(null);
        setEquitiesYmd(null);
        setEquitiesError(!json.ok ? json.error : res.statusText);
        return;
      }
      setEquitiesYmd(json.ymd);
      setEquitiesRow(json.row);
      if (json.setupRequired && json.setupMessage) {
        setEquitiesSetupHint(json.setupMessage);
      }
    } catch (e) {
      setEquitiesRow(null);
      setEquitiesYmd(null);
      setEquitiesError(e instanceof Error ? e.message : "Failed to load equities writeup");
    } finally {
      setEquitiesLoading(false);
    }
  }, []);

  const loadCalendarPeek = useCallback(async () => {
    try {
      const n = await fetchCalendarCountToday();
      setCalendarPeek(n === 0 ? "No events today" : `${n} Events today`);
    } catch {
      setCalendarPeek("Calendar unavailable");
    }
  }, []);

  const loadEarningsPeek = useCallback(async () => {
    try {
      const res = await fetch("/api/earnings-calendar", { cache: "no-store" });
      const json = (await res.json()) as EarningsCalendarResponse & { error?: string };
      if (!res.ok) {
        setEarningsPeek("Earnings unavailable");
        return;
      }
      const today = json.buckets?.today ?? [];
      if (!today.length) {
        setEarningsPeek("No earnings today");
        return;
      }
      setEarningsPeek(formatTopTickersDashed(today.map((r) => r.ticker)));
    } catch {
      setEarningsPeek("Earnings unavailable");
    }
  }, []);

  const loadMoversPeek = useCallback(async () => {
    if (!filtersHydrated) {
      setMoversPeek("…");
      return;
    }
    try {
      const res = await fetch("/api/movers/gappers", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(gapperBody),
        cache: "no-store",
      });
      const json = (await res.json()) as GappersResponse & { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setMoversPeek("Gappers unavailable");
        return;
      }
      const rows = json.rows ?? [];
      if (!rows.length) {
        setMoversPeek("No gappers");
        return;
      }
      setMoversPeek(formatTopTickersDashed(topTickersByGapPct(rows)));
    } catch {
      setMoversPeek("Gappers unavailable");
    }
  }, [filtersHydrated, gapperBody]);

  const loadSipPeek = useCallback(async () => {
    if (!filtersHydrated) {
      setSipPeek("…");
      return;
    }
    try {
      const res = await fetch("/api/premarket/stocks-in-play", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(gapperBody),
        cache: "no-store",
      });
      const json = (await res.json()) as StocksInPlaySuccess | { ok?: false; error?: string };
      if (!res.ok || !json.ok) {
        setSipPeek("SIP unavailable");
        return;
      }
      const rows = json.rows ?? [];
      if (!rows.length) {
        setSipPeek("No gappers");
        return;
      }
      setSipPeek(formatTopTickersDashed(topTickersByGapPct(rows)));
    } catch {
      setSipPeek("SIP unavailable");
    }
  }, [filtersHydrated, gapperBody]);

  const refreshAuxPeeks = useCallback(async () => {
    await Promise.all([loadCalendarPeek(), loadEarningsPeek(), loadMoversPeek(), loadSipPeek()]);
  }, [loadCalendarPeek, loadEarningsPeek, loadMoversPeek, loadSipPeek]);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadMacro(), loadEquities(), refreshAuxPeeks()]);
  }, [loadMacro, loadEquities, refreshAuxPeeks]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  /** Weekdays 7:00, 8:00, 9:00 AM America/New_York — refresh macro + peeks once per hour slot. */
  useEffect(() => {
    const tick = () => {
      const z = DateTime.now().setZone("America/New_York");
      const wd = z.weekday;
      if (wd > 5) return;
      const h = z.hour;
      const m = z.minute;
      if (![7, 8, 9].includes(h)) return;
      if (m > 14) return;
      const slot = `${z.toISODate()}-${h}`;
      if (lastScheduledSlotRef.current === slot) return;
      lastScheduledSlotRef.current = slot;
      void refreshAll();
    };

    tick();
    const id = window.setInterval(tick, 30_000);
    const onVis = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refreshAll]);

  const peeks: PremarketPeeks = useMemo(() => {
    const macroText = macroRow?.writeup_text?.trim() ?? "";
    const macroKw = macroText ? deriveMacroPeekKeywords(macroText, 2) : null;
    const eqBullets = equitiesRow?.bullets?.map((b) => b.trim()).filter(Boolean) ?? [];
    const eqPeekParts = eqBullets.slice(0, 2).map((b) => (b.length > 48 ? `${b.slice(0, 45)}…` : b));
    const eqPeek = eqPeekParts.length ? eqPeekParts.join(" · ") : null;

    const stillLoading = macroLoading || equitiesLoading;
    const hasPartial = Boolean(macroKw || eqPeek);

    let context: string;
    if (stillLoading && !hasPartial) {
      context = "…";
    } else if (macroKw && eqPeek) {
      context = `${macroKw} · ${eqPeek}`;
    } else if (macroKw) {
      context = macroKw;
    } else if (eqPeek) {
      context = eqPeek;
    } else {
      context = "No brief yet";
    }

    return {
      context,
      sip: sipPeek,
      calendars: calendarPeek,
      earnings: earningsPeek,
      movers: moversPeek,
    };
  }, [macroRow, macroLoading, equitiesRow, equitiesLoading, calendarPeek, earningsPeek, moversPeek, sipPeek]);

  return {
    peeks,
    macroRow,
    macroYmd,
    macroLoading,
    macroError,
    equitiesRow,
    equitiesYmd,
    equitiesLoading,
    equitiesError,
    equitiesSetupHint,
    refreshMacro: loadMacro,
    refreshEquities: loadEquities,
    refreshAll,
  };
}
