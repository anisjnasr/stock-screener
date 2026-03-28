"use client";

import { useState, useCallback, useEffect } from "react";
import { loadPanelHeightPx, savePanelHeightPx } from "@/lib/watchlist-storage";
import { cloudSyncSetting } from "@/lib/cloud-sync";

const WATCHLIST_PANEL_USER_SET_KEY = "stock-research-watchlist-panel-user-set";
const CHART_LEFT_KEY = "ws-chart-left-px";
const CHART_LEFT_SECTORS_KEY = "ws-chart-left-sectors-px";
const RAIL_WIDTH_KEY = "ws-rail-width-px";
const RIGHT_RAIL_HIDDEN_KEY = "ws-right-rail-hidden";

const DEFAULT_CHART_LEFT = 480;
const DEFAULT_CHART_LEFT_SECTORS = -1; // -1 means "compute dynamically"
const DEFAULT_RAIL_WIDTH = 260;

function loadNumber(key: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

function saveNumber(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(Math.round(value)));
  } catch {
    /* ignore */
  }
}

function syncLayoutToCloud(): void {
  if (typeof window === "undefined") return;
  const s = localStorage;
  const tryNum = (k: string) => { const v = s.getItem(k); return v != null ? Number(v) : undefined; };
  const tryBool = (k: string) => { const v = s.getItem(k); return v != null ? v === "true" : undefined; };
  cloudSyncSetting("layout_preferences", {
    chartLeftPx: tryNum(CHART_LEFT_KEY),
    chartLeftSectorsPx: tryNum(CHART_LEFT_SECTORS_KEY),
    railWidthPx: tryNum(RAIL_WIDTH_KEY),
    rightRailHidden: tryBool(RIGHT_RAIL_HIDDEN_KEY),
    leftSidebarHidden: tryBool("stock-research-left-sidebar-hidden"),
    quarterlyHidden: tryBool("stock-research-quarterly-hidden"),
  });
}

export function useLayoutPreferences() {
  const [watchlistHeightPx, setWatchlistHeightPx] = useState(32);
  const [leftSidebarHidden, setLeftSidebarHidden] = useState(false);
  const [quarterlyHidden, setQuarterlyHidden] = useState(false);

  // New workspace layout dimensions
  const [chartLeftPx, setChartLeftPxState] = useState(DEFAULT_CHART_LEFT);
  const [chartLeftSectorsPx, setChartLeftSectorsPxState] = useState(DEFAULT_CHART_LEFT_SECTORS);
  const [railWidthPx, setRailWidthPxState] = useState(DEFAULT_RAIL_WIDTH);
  const [rightRailHidden, setRightRailHidden] = useState(false);

  useEffect(() => {
    try {
      const userSet = localStorage.getItem(WATCHLIST_PANEL_USER_SET_KEY) === "true";
      setWatchlistHeightPx(userSet ? loadPanelHeightPx() : 32);
      const storedLeft = localStorage.getItem("stock-research-left-sidebar-hidden");
      if (storedLeft !== null) setLeftSidebarHidden(storedLeft === "true");
      const storedQuarterly = localStorage.getItem("stock-research-quarterly-hidden");
      if (storedQuarterly !== null) setQuarterlyHidden(storedQuarterly === "true");
      setChartLeftPxState(loadNumber(CHART_LEFT_KEY, DEFAULT_CHART_LEFT));
      setChartLeftSectorsPxState(loadNumber(CHART_LEFT_SECTORS_KEY, DEFAULT_CHART_LEFT_SECTORS));
      setRailWidthPxState(loadNumber(RAIL_WIDTH_KEY, DEFAULT_RAIL_WIDTH));
      const storedRailHidden = localStorage.getItem(RIGHT_RAIL_HIDDEN_KEY);
      if (storedRailHidden !== null) setRightRailHidden(storedRailHidden === "true");
    } catch {
      /* ignore */
    }
  }, []);

  const handleWatchlistHeightChange = useCallback((px: number) => {
    setWatchlistHeightPx(px);
    savePanelHeightPx(px);
    try {
      localStorage.setItem(WATCHLIST_PANEL_USER_SET_KEY, "true");
    } catch {
      /* ignore */
    }
  }, []);

  const handleLeftSidebarToggle = useCallback(() => {
    setLeftSidebarHidden((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("stock-research-left-sidebar-hidden", String(next));
      } catch {
        /* ignore */
      }
      syncLayoutToCloud();
      return next;
    });
  }, []);

  const handleQuarterlyToggle = useCallback(() => {
    setQuarterlyHidden((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("stock-research-quarterly-hidden", String(next));
      } catch {
        /* ignore */
      }
      syncLayoutToCloud();
      return next;
    });
  }, []);

  const setChartLeftPx = useCallback((px: number) => {
    const clamped = Math.max(0, px);
    setChartLeftPxState(clamped);
    saveNumber(CHART_LEFT_KEY, clamped);
    syncLayoutToCloud();
  }, []);

  const setChartLeftSectorsPx = useCallback((px: number) => {
    const clamped = Math.max(0, px);
    setChartLeftSectorsPxState(clamped);
    saveNumber(CHART_LEFT_SECTORS_KEY, clamped);
    syncLayoutToCloud();
  }, []);

  const setRailWidthPx = useCallback((px: number) => {
    const clamped = Math.max(200, Math.min(400, px));
    setRailWidthPxState(clamped);
    saveNumber(RAIL_WIDTH_KEY, clamped);
    syncLayoutToCloud();
  }, []);

  const handleRightRailToggle = useCallback(() => {
    setRightRailHidden((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(RIGHT_RAIL_HIDDEN_KEY, String(next));
      } catch {
        /* ignore */
      }
      syncLayoutToCloud();
      return next;
    });
  }, []);

  return {
    watchlistHeightPx,
    setWatchlistHeightPx,
    leftSidebarHidden,
    quarterlyHidden,
    handleWatchlistHeightChange,
    handleLeftSidebarToggle,
    handleQuarterlyToggle,
    chartLeftPx,
    setChartLeftPx,
    chartLeftSectorsPx,
    setChartLeftSectorsPx,
    railWidthPx,
    setRailWidthPx,
    rightRailHidden,
    setRightRailHidden,
    handleRightRailToggle,
  };
}
