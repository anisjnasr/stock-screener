"use client";

import { useCallback, useLayoutEffect, useState } from "react";
import {
  getDefaultLayout,
  parseLayout,
  PREMARKET_LAYOUT_LS_KEY,
  PREMARKET_SECTION_IDS,
  type PremarketLayoutState,
  type PremarketSectionId,
} from "./premarket-layout-storage";

function allSectionsCollapsed(collapsed: boolean): Record<PremarketSectionId, boolean> {
  return Object.fromEntries(PREMARKET_SECTION_IDS.map((id) => [id, collapsed])) as Record<
    PremarketSectionId,
    boolean
  >;
}

function persistLayout(layout: PremarketLayoutState) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PREMARKET_LAYOUT_LS_KEY, JSON.stringify(layout));
  } catch {
    /* ignore quota / private mode */
  }
}

/**
 * Pre-market collapsible layout persisted under `stockstalker-premarket-layout-v1`.
 * Loads from localStorage in useLayoutEffect (before paint). Writes only from explicit
 * user actions — never from a passive effect on the initial default state, which would
 * overwrite saved collapse state when switching workspace tabs or on Strict Mode remounts.
 */
export function usePremarketLayout() {
  const [layout, setLayout] = useState<PremarketLayoutState>(() => getDefaultLayout());

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    const raw = localStorage.getItem(PREMARKET_LAYOUT_LS_KEY);
    const parsed = parseLayout(raw);
    if (parsed) setLayout(parsed);
  }, []);

  const setCollapsed = useCallback((id: PremarketSectionId, collapsed: boolean) => {
    setLayout((prev) => {
      const next: PremarketLayoutState = {
        ...prev,
        collapsed_sections: { ...prev.collapsed_sections, [id]: collapsed },
      };
      persistLayout(next);
      return next;
    });
  }, []);

  const toggle = useCallback((id: PremarketSectionId) => {
    setLayout((prev) => {
      const next: PremarketLayoutState = {
        ...prev,
        collapsed_sections: {
          ...prev.collapsed_sections,
          [id]: !prev.collapsed_sections[id],
        },
      };
      persistLayout(next);
      return next;
    });
  }, []);

  const collapseAll = useCallback(() => {
    const next: PremarketLayoutState = {
      version: 1,
      collapsed_sections: allSectionsCollapsed(true),
    };
    setLayout(next);
    persistLayout(next);
  }, []);

  const expandAll = useCallback(() => {
    const next: PremarketLayoutState = {
      version: 1,
      collapsed_sections: allSectionsCollapsed(false),
    };
    setLayout(next);
    persistLayout(next);
  }, []);

  return {
    collapsed: layout.collapsed_sections,
    setCollapsed,
    toggle,
    collapseAll,
    expandAll,
  };
}
