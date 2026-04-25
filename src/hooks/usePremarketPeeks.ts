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

function countTodayEvents<T extends { event_date: string; impact: string }>(rows: T[], todayYmd: string): number {
  return rows.filter((ev) => ev.event_date === todayYmd && String(ev.impact).toLowerCase() !== "low").length;
}

function joinPeekParts(parts: string[]): string {
  return parts.join(" - ");
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
  const econCount = countTodayEvents<EconomicEventPublic>(econ, todayYmd);
  const keyCount = countTodayEvents<MarketEventPublic>(mkt, todayYmd);
  return `${econCount} Economic and ${keyCount} Key Events Today`;
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
  const [moversPeek, setMoversPeek] = useState("");
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
      setEarningsPeek(joinPeekParts(top));
    } catch {
      setEarningsPeek("Earnings unavailable");
    }
  }, []);

  const loadMoversPeek = useCallback(async () => {
    if (!filtersHydrated) {
      setMoversPeek("");
      return;
    }
    setMoversPeek("");
  }, [filtersHydrated]);

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
      setSipPeek(joinPeekParts(tickers));
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
      setThemePeek(joinPeekParts(sorted.slice(0, 5).map((t) => keywordFromThemeTitle(t.theme_title))));
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
