"use client";

import { useEffect, useCallback, useRef } from "react";

type ShortcutAction = () => void;

type Shortcut = {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  description: string;
  action: ShortcutAction;
  category: "navigation" | "chart" | "general";
};

function isInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

function matchesShortcut(e: KeyboardEvent, s: Shortcut): boolean {
  if (e.key.toLowerCase() !== s.key.toLowerCase()) return false;
  if (s.ctrl && !e.ctrlKey && !e.metaKey) return false;
  if (s.shift && !e.shiftKey) return false;
  if (s.alt && !e.altKey) return false;
  if (!s.ctrl && (e.ctrlKey || e.metaKey)) return false;
  if (!s.shift && e.shiftKey) return false;
  if (!s.alt && e.altKey) return false;
  return true;
}

export type ShortcutDefinition = Omit<Shortcut, "action"> & { id: string };

export function useKeyboardShortcuts(shortcuts: Shortcut[]) {
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isInputFocused()) return;
      for (const s of shortcutsRef.current) {
        if (matchesShortcut(e, s)) {
          e.preventDefault();
          s.action();
          return;
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
}

export function formatShortcut(s: ShortcutDefinition): string {
  const parts: string[] = [];
  if (s.ctrl) parts.push("Ctrl");
  if (s.alt) parts.push("Alt");
  if (s.shift) parts.push("Shift");
  parts.push(s.key.length === 1 ? s.key.toUpperCase() : s.key);
  return parts.join("+");
}

export const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
  { id: "search-focus", key: "/", description: "Focus search bar", category: "general" },
  { id: "escape", key: "Escape", description: "Unfocus / close dialogs", category: "general" },
  { id: "toggle-sidebar", key: "b", description: "Toggle left sidebar", category: "general" },
  { id: "toggle-quarterly", key: "q", description: "Toggle quarterly panel", category: "general" },
  { id: "toggle-theme", key: "t", description: "Cycle theme (dark/light/system)", category: "general" },
  { id: "show-shortcuts", key: "?", shift: true, description: "Show keyboard shortcuts", category: "general" },
  { id: "nav-home", key: "1", description: "Go to Home", category: "navigation" },
  { id: "nav-sectors", key: "2", description: "Go to Sectors / Industries", category: "navigation" },
  { id: "nav-monitor", key: "3", description: "Go to Market Monitor", category: "navigation" },
  { id: "nav-breadth", key: "4", description: "Go to Breadth", category: "navigation" },
  { id: "scan-prev", key: "ArrowUp", description: "Previous symbol in scan list", category: "navigation" },
  { id: "scan-next", key: "ArrowDown", description: "Next symbol in scan list", category: "navigation" },
  { id: "chart-daily", key: "d", description: "Switch chart to daily", category: "chart" },
  { id: "chart-weekly", key: "w", description: "Switch chart to weekly", category: "chart" },
  { id: "chart-monthly", key: "m", description: "Switch chart to monthly", category: "chart" },
  { id: "chart-dual", key: "s", description: "Toggle dual chart mode", category: "chart" },
  { id: "chart-ray", key: "h", description: "Draw horizontal ray", category: "chart" },
  { id: "chart-trend", key: "l", description: "Draw trend line", category: "chart" },
];
