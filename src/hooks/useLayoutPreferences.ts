"use client";

import { useState, useCallback, useEffect } from "react";
import { loadPanelHeightPx, savePanelHeightPx } from "@/lib/watchlist-storage";

const WATCHLIST_PANEL_USER_SET_KEY = "stock-research-watchlist-panel-user-set";
const CHART_LEFT_KEY = "ws-chart-left-px";
const RAIL_WIDTH_KEY = "ws-rail-width-px";
const RIGHT_RAIL_HIDDEN_KEY = "ws-right-rail-hidden";

const DEFAULT_CHART_LEFT = 340;
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

export function useLayoutPreferences() {
  const [watchlistHeightPx, setWatchlistHeightPx] = useState(32);
  const [leftSidebarHidden, setLeftSidebarHidden] = useState(false);
  const [quarterlyHidden, setQuarterlyHidden] = useState(false);

  // New workspace layout dimensions
  const [chartLeftPx, setChartLeftPxState] = useState(DEFAULT_CHART_LEFT);
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
      return next;
    });
  }, []);

  const setChartLeftPx = useCallback((px: number) => {
    const clamped = Math.max(200, Math.min(600, px));
    setChartLeftPxState(clamped);
    saveNumber(CHART_LEFT_KEY, clamped);
  }, []);

  const setRailWidthPx = useCallback((px: number) => {
    const clamped = Math.max(200, Math.min(400, px));
    setRailWidthPxState(clamped);
    saveNumber(RAIL_WIDTH_KEY, clamped);
  }, []);

  const handleRightRailToggle = useCallback(() => {
    setRightRailHidden((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(RIGHT_RAIL_HIDDEN_KEY, String(next));
      } catch {
        /* ignore */
      }
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
    railWidthPx,
    setRailWidthPx,
    rightRailHidden,
    handleRightRailToggle,
  };
}
