"use client";

import { SHORTCUT_DEFINITIONS, formatShortcut, type ShortcutDefinition } from "@/hooks/useKeyboardShortcuts";

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

function groupByCategory(items: ShortcutDefinition[]): Record<string, ShortcutDefinition[]> {
  const groups: Record<string, ShortcutDefinition[]> = {};
  for (const item of items) {
    if (!groups[item.category]) groups[item.category] = [];
    groups[item.category].push(item);
  }
  return groups;
}

const CATEGORY_LABELS: Record<string, string> = {
  general: "General",
  navigation: "Navigation",
  chart: "Chart",
};

export default function KeyboardShortcutsModal({ isOpen, onClose }: Props) {
  if (!isOpen) return null;
  const groups = groupByCategory(SHORTCUT_DEFINITIONS);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-label="Keyboard shortcuts"
    >
      <div
        className="w-[480px] max-w-[90vw] max-h-[80vh] overflow-auto rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Keyboard Shortcuts
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
            aria-label="Close"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        {Object.entries(groups).map(([category, shortcuts]) => (
          <div key={category} className="mb-5 last:mb-0">
            <h3 className="text-xs font-semibold tracking-wide text-zinc-400 dark:text-zinc-500 mb-2">
              {CATEGORY_LABELS[category] ?? category}
            </h3>
            <div className="space-y-1">
              {shortcuts.map((s) => (
                <div key={s.id} className="flex items-center justify-between py-1.5">
                  <span className="text-sm text-zinc-700 dark:text-zinc-300">{s.description}</span>
                  <kbd className="inline-flex items-center gap-0.5 rounded border border-zinc-200 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-800 px-2 py-0.5 text-xs font-mono text-zinc-600 dark:text-zinc-300 shadow-sm">
                    {formatShortcut(s)}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        ))}
        <p className="mt-4 text-[11px] text-zinc-400 dark:text-zinc-500">
          Shortcuts are disabled when a text input is focused. Press <kbd className="font-mono">Esc</kbd> to unfocus.
        </p>
      </div>
    </div>
  );
}
