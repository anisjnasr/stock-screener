"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DateTime } from "luxon";
import { ymdInEt } from "@/lib/et-ymd";
import { gapperFilterStateToRequestBody, type GapperFilterState } from "@/components/premarket/gapper-filters-storage";
import { keywordFromThemeTitle } from "@/lib/premarket/theme-peek-keyword";
import type { DailyEquitiesWriteupRow, DailyMacroWriteupRow } from "@/types/newsletter-macro";
import type { DailyThemeRow } from "@/types/daily-themes";
import type { EconomicEventPublic, EconomicEventsResponse } from "@/types/economic-events";
import type { MarketEventPublic, MarketEventsResponse } from "@/types/market-events";
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

/** Top tickers by gap % with ± gap for collapsed peek (dedupe keeps first / highest gap). */
function formatTopGapperPeeks(rows: { ticker: string; gapPct: number }[], max = 5): string {
  if (!rows.length) return "No names";
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
    const sign = r.gapPct >= 0 ? "+" : "";
    out.push(`${t} ${sign}${r.gapPct.toFixed(1)}%`);
    if (out.length >= max) break;
  }
  return out.join(" · ");
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

function sortKeyForCal(date: string, time: string | null): string {
  return `${date}T${timeForSort(time)}`;
}

function formatPeekTimeEt(hms: string | null): string {
  if (!hms) return "TBD";
  const [hs, ms] = hms.split(":");
  const h = Number(hs);
  const m = Number(ms);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hms;
  const ap = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${ap}`;
}

function mergeCalendarPeekRows(
  econ: EconomicEventPublic[],
  mkt: MarketEventPublic[],
  todayYmd: string
): { sortKey: string; timeEt: string | null }[] {
  const rows: { sortKey: string; timeEt: string | null }[] = [];
  for (const ev of econ) {
    if (ev.event_date !== todayYmd) continue;
    if (String(ev.impact).toLowerCase() === "low") continue;
    rows.push({ sortKey: sortKeyForCal(ev.event_date, ev.event_time_et), timeEt: ev.event_time_et });
  }
  for (const ev of mkt) {
    if (ev.event_date !== todayYmd) continue;
    if (String(ev.impact).toLowerCase() === "low") continue;
    rows.push({ sortKey: sortKeyForCal(ev.event_date, ev.event_time_et), timeEt: ev.event_time_et });
  }
  rows.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  return rows;
}

async function fetchCalendarPeekToday(): Promise<string> {
  const todayYmd = ymdInEt();
  const econQs = new URLSearchParams({ impact: "High,Medium" });
  const mktQs = new URLSearchParams({ impact: "High,Medium" });
  const [eRes, mRes] = await Promise.all([
    fetch(`/api/economic-events?${econQs.toString()}`, { cache: "no-store" }),
    fetch(`/api/market-events?${mktQs.toString()}`, { cache: "no-store" }),
  ]);
  const eJson = (await eRes.json()) as EconomicEventsResponse & { error?: string };
  const mJson = (await mRes.json()) as MarketEventsResponse & { error?: string };
  const econ = eRes.ok ? eJson.events ?? [] : [];
  const mkt = mRes.ok ? mJson.events ?? [] : [];
  const rows = mergeCalendarPeekRows(econ, mkt, todayYmd);
  if (!rows.length) return "No events today";
  const n = rows.length;
  const next = formatPeekTimeEt(rows[0].timeEt);
  return `${n} event${n === 1 ? "" : "s"} · next ${next}`;
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
  const [themePeek, setThemePeek] = useState("…");

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
      setCalendarPeek(await fetchCalendarPeekToday());
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
      const sorted = [...today].sort((a, b) => {
        const ma = a.market_cap_usd ?? -1;
        const mb = b.market_cap_usd ?? -1;
        if (mb !== ma) return mb - ma;
        return a.ticker.localeCompare(b.ticker);
      });
      const top = sorted.slice(0, 5).map((r) => r.ticker.trim().toUpperCase()).filter(Boolean);
      setEarningsPeek(top.join(" · "));
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
      setMoversPeek(formatTopGapperPeeks(rows));
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
        setSipPeek("No SIP rows");
        return;
      }
      const tickers = [...new Set(rows.map((r) => r.ticker.trim().toUpperCase()).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b)
      );
      setSipPeek(tickers.join(" · "));
    } catch {
      setSipPeek("SIP unavailable");
    }
  }, [filtersHydrated, gapperBody]);

  const loadThemePeek = useCallback(async () => {
    try {
      const res = await fetch("/api/premarket/daily-themes", { cache: "no-store" });
      const json = (await res.json()) as { ok?: boolean; themes?: DailyThemeRow[]; error?: string };
      if (!res.ok || json.ok === false) {
        setThemePeek("Themes unavailable");
        return;
      }
      const themes = json.themes ?? [];
      if (!themes.length) {
        setThemePeek("No themes");
        return;
      }
      const sorted = [...themes].sort((a, b) => {
        const oa = a.theme_type === "macro" ? 0 : 1;
        const ob = b.theme_type === "macro" ? 0 : 1;
        if (oa !== ob) return oa - ob;
        return a.theme_rank - b.theme_rank;
      });
      setThemePeek(sorted.map((t) => keywordFromThemeTitle(t.theme_title)).join(" · "));
    } catch {
      setThemePeek("Themes unavailable");
    }
  }, []);

  const refreshAuxPeeks = useCallback(async () => {
    await Promise.all([loadCalendarPeek(), loadEarningsPeek(), loadMoversPeek(), loadSipPeek(), loadThemePeek()]);
  }, [loadCalendarPeek, loadEarningsPeek, loadMoversPeek, loadSipPeek, loadThemePeek]);

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

  const peeks: PremarketPeeks = useMemo(
    () => ({
      context: themePeek,
      sip: sipPeek,
      calendars: calendarPeek,
      earnings: earningsPeek,
      movers: moversPeek,
    }),
    [themePeek, sipPeek, calendarPeek, earningsPeek, moversPeek]
  );

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
