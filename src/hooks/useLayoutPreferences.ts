"use client";

import { useState, useCallback, useEffect } from "react";
import { loadPanelHeightPx, savePanelHeightPx } from "@/lib/watchlist-storage";

const WATCHLIST_PANEL_USER_SET_KEY = "stock-research-watchlist-panel-user-set";

export function useLayoutPreferences() {
  const [watchlistHeightPx, setWatchlistHeightPx] = useState(32);
  const [leftSidebarHidden, setLeftSidebarHidden] = useState(false);
  const [quarterlyHidden, setQuarterlyHidden] = useState(false);

  useEffect(() => {
    try {
      const userSet = localStorage.getItem(WATCHLIST_PANEL_USER_SET_KEY) === "true";
      setWatchlistHeightPx(userSet ? loadPanelHeightPx() : 32);
      const storedLeft = localStorage.getItem("stock-research-left-sidebar-hidden");
      if (storedLeft !== null) setLeftSidebarHidden(storedLeft === "true");
      const storedQuarterly = localStorage.getItem("stock-research-quarterly-hidden");
      if (storedQuarterly !== null) setQuarterlyHidden(storedQuarterly === "true");
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

  return {
    watchlistHeightPx,
    setWatchlistHeightPx,
    leftSidebarHidden,
    quarterlyHidden,
    handleWatchlistHeightChange,
    handleLeftSidebarToggle,
    handleQuarterlyToggle,
  };
}
