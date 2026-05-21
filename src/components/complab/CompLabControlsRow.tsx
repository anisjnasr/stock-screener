"use client";

import type { CompLabSortMode } from "@/lib/complab/comp-lab-comps";

type Props = {
  referenceDate: string;
  matchCount: number;
  ratedCount: number;
  sortMode: CompLabSortMode;
  onSortModeChange: (mode: CompLabSortMode) => void;
  onClearReferenceDate: () => void;
};

export default function CompLabControlsRow({
  referenceDate,
  matchCount,
  ratedCount,
  sortMode,
  onSortModeChange,
  onClearReferenceDate,
}: Props) {
  return (
    <div
      className="flex flex-col gap-3 rounded border px-3 py-3 sm:px-4"
      style={{ borderColor: "var(--ws-border)", background: "var(--ws-bg3)" }}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--ws-text-dim)" }}>
            Reference
          </span>
          <span className="font-mono font-medium" style={{ color: "var(--ws-text)" }}>
            {referenceDate}
          </span>
          <button
            type="button"
            className="text-xs underline"
            style={{ color: "var(--ws-text-dim)" }}
            onClick={onClearReferenceDate}
          >
            Clear
          </button>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--ws-text-dim)" }}>
            Sort
          </span>
          <div
            className="inline-flex overflow-hidden rounded border text-xs"
            style={{ borderColor: "var(--ws-border)" }}
          >
            {(["similarity", "recent"] as const).map((mode) => {
              const active = sortMode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  className="px-2.5 py-1 capitalize"
                  style={{
                    background: active ? "var(--ws-cyan)" : "transparent",
                    color: active ? "var(--ws-bg)" : "var(--ws-text)",
                  }}
                  onClick={() => onSortModeChange(mode)}
                >
                  {mode === "similarity" ? "Similarity" : "Recent"}
                </button>
              );
            })}
          </div>
        </div>

        <span className="text-xs" style={{ color: "var(--ws-text-dim)" }}>
          {matchCount} comps found · {ratedCount} rated
        </span>
      </div>

      <p className="text-xs leading-relaxed" style={{ color: "var(--ws-text-dim)" }}>
        Rate match quality: 1 = barely related · 5 = near-identical · ignore the outcome
      </p>
    </div>
  );
}
