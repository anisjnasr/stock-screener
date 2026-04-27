"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DateTime } from "luxon";
import type { DailyEquitiesWriteupRow, DailyMacroWriteupRow } from "@/types/newsletter-macro";

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

/** Loads macro + equities writeups for the pre-market page (no collapsed-section peek strings). */
export function usePremarketPeeks() {
  const [macroRow, setMacroRow] = useState<DailyMacroWriteupRow | null>(null);
  const [macroYmd, setMacroYmd] = useState<string | null>(null);
  const [macroLoading, setMacroLoading] = useState(true);
  const [macroError, setMacroError] = useState<string | null>(null);

  const [equitiesRow, setEquitiesRow] = useState<DailyEquitiesWriteupRow | null>(null);
  const [equitiesYmd, setEquitiesYmd] = useState<string | null>(null);
  const [equitiesLoading, setEquitiesLoading] = useState(true);
  const [equitiesError, setEquitiesError] = useState<string | null>(null);
  const [equitiesSetupHint, setEquitiesSetupHint] = useState<string | null>(null);

  const lastScheduledSlotRef = useRef<string | null>(null);

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

  const refreshAll = useCallback(async () => {
    await Promise.all([loadMacro(), loadEquities()]);
  }, [loadMacro, loadEquities]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  /** Refresh while scheduled UAE newsletter/pipeline windows are active. */
  useEffect(() => {
    const tick = () => {
      const z = DateTime.now().setZone("Asia/Dubai");
      const wd = z.weekday;
      if (wd > 5) return;
      const h = z.hour;
      const m = z.minute;
      if (![6, 7, 13, 14, 15, 16, 17].includes(h)) return;
      const slot = `${z.toISODate()}-${h}-${Math.floor(m / 10)}`;
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

  return {
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
