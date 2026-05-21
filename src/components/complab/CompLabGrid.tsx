"use client";

import { useMemo, useState } from "react";
import CompLabCompCard from "@/components/complab/CompLabCompCard";
import CompLabControlsRow from "@/components/complab/CompLabControlsRow";
import type { CompLabCandle } from "@/lib/complab/chart-series";
import {
  COMP_LAB_PAGE_SIZE,
  sortCompLabComps,
  type CompLabComp,
  type CompLabSortMode,
} from "@/lib/complab/comp-lab-comps";

type Props = {
  referenceDate: string;
  comps: CompLabComp[];
  candles: CompLabCandle[];
  loading?: boolean;
  error?: string | null;
  onClearReferenceDate: () => void;
};

export default function CompLabGrid({
  referenceDate,
  comps,
  candles,
  loading = false,
  error = null,
  onClearReferenceDate,
}: Props) {
  const [sortMode, setSortMode] = useState<CompLabSortMode>("similarity");
  const [visibleCount, setVisibleCount] = useState(COMP_LAB_PAGE_SIZE);

  const sorted = useMemo(() => sortCompLabComps(comps, sortMode), [comps, sortMode]);
  const visible = sorted.slice(0, visibleCount);
  const remaining = Math.max(0, sorted.length - visible.length);

  if (loading) {
    return (
      <div className="rounded border px-4 py-8 text-center text-sm" style={{ borderColor: "var(--ws-border)", color: "var(--ws-text-dim)" }}>
        Running comp engine…
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-sm" style={{ color: "var(--ws-red, #f87171)" }} role="alert">
        {error}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <CompLabControlsRow
        referenceDate={referenceDate}
        matchCount={comps.length}
        ratedCount={0}
        sortMode={sortMode}
        onSortModeChange={(mode) => {
          setSortMode(mode);
          setVisibleCount(COMP_LAB_PAGE_SIZE);
        }}
        onClearReferenceDate={onClearReferenceDate}
      />

      {comps.length === 0 ? (
        <div className="rounded border px-4 py-8 text-center" style={{ borderColor: "var(--ws-border)" }}>
          <p className="text-sm" style={{ color: "var(--ws-text)" }}>
            No comps found for this setup with current tolerances.
          </p>
          <p className="mt-2 text-xs" style={{ color: "var(--ws-text-dim)" }}>
            Try loosening tolerances in the comp engine config, or pick a different reference date.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {visible.map((comp) => (
              <CompLabCompCard key={comp.comp_date} comp={comp} candles={candles} />
            ))}
          </div>

          {remaining > 0 && (
            <div className="flex justify-center pt-1">
              <button
                type="button"
                className="rounded border px-4 py-2 text-sm"
                style={{
                  borderColor: "var(--ws-border)",
                  color: "var(--ws-text)",
                  background: "var(--ws-bg3)",
                }}
                onClick={() => setVisibleCount((n) => n + COMP_LAB_PAGE_SIZE)}
              >
                Show 10 more ({remaining} remaining)
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
