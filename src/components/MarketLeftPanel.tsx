"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import MarketMonitorTable from "@/components/MarketMonitorTable";
import type { MarketMonitorListCreatedInfo } from "@/components/MarketMonitorConstituentsModal";

const MM_INFO_POPOVER_WIDTH = 360;

function MmLegendSwatch({ bg, label }: { bg: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className="inline-block h-3.5 w-6 shrink-0 rounded-sm border"
        style={{ background: bg, borderColor: "var(--ws-border)" }}
      />
      <span>{label}</span>
    </div>
  );
}

/** Info "i" icon + hover/click popover explaining the Market Monitor color-coding logic. */
function MarketMonitorColorInfo() {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reposition = useCallback(() => {
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect) return;
    const margin = 8;
    const left = Math.max(
      margin,
      Math.min(rect.left, window.innerWidth - MM_INFO_POPOVER_WIDTH - margin)
    );
    setCoords({ top: rect.bottom + 6, left });
  }, []);

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const show = useCallback(() => {
    cancelClose();
    reposition();
    setOpen(true);
  }, [cancelClose, reposition]);

  // The popover is portaled to <body>, so moving the cursor from the icon into
  // it briefly leaves the trigger; a short close delay bridges that gap.
  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimerRef.current = setTimeout(() => setOpen(false), 120);
  }, [cancelClose]);

  useEffect(() => cancelClose, [cancelClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, reposition]);

  const popoverStyle: CSSProperties = {
    position: "fixed",
    top: coords?.top ?? 0,
    left: coords?.left ?? 0,
    width: MM_INFO_POPOVER_WIDTH,
    maxWidth: "calc(100vw - 16px)",
    background: "var(--ws-bg)",
    border: "1px solid var(--ws-border)",
    color: "var(--ws-text)",
    zIndex: 60,
  };

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={scheduleClose}
    >
      <button
        ref={btnRef}
        type="button"
        aria-label="Explain cell color coding"
        aria-expanded={open}
        className="ws-focus-ring flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold leading-none"
        style={{
          border: "1px solid var(--ws-cyan)",
          color: "var(--ws-cyan)",
          background: "transparent",
          cursor: "help",
        }}
        onClick={() => (open ? setOpen(false) : show())}
        onFocus={show}
        onBlur={() => setOpen(false)}
      >
        i
      </button>
      {open && typeof document !== "undefined" && createPortal(
        <div
          role="tooltip"
          className="rounded-md p-3 text-left shadow-lg"
          style={popoverStyle}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          <p className="mb-1 text-ws-body font-bold" style={{ color: "var(--ws-cyan)" }}>
            How cell colors work
          </p>

          <p className="mb-1.5 text-ws-caption font-semibold" style={{ color: "var(--ws-text)" }}>
            Breadth count columns
          </p>
          <p className="mb-1.5 text-ws-caption" style={{ color: "var(--ws-text-dim)" }}>
            Up %, Down %, Up/Down 25% (Q &amp; M), Up/Down 50% (M), and 52W Highs/Lows are shaded by
            how today&apos;s reading ranks against its own trailing ~1&#8209;year history (252 sessions).
            Up columns and 52W Highs are bullish (a high reading is green); Down columns and 52W Lows
            are bearish (a high reading is red).
          </p>
          <div className="mb-1.5 flex flex-col gap-1 text-ws-caption" style={{ color: "var(--ws-text-dim)" }}>
            <MmLegendSwatch bg="var(--ws-mm-heat-green-very-bg)" label="Top decile (≥ 90th pct) — extreme" />
            <MmLegendSwatch bg="var(--ws-mm-heat-green-strong-bg)" label="Elevated (70th–90th pct)" />
            <MmLegendSwatch bg="transparent" label="Normal range (30th–70th pct) — no fill" />
            <MmLegendSwatch bg="var(--ws-mm-heat-red-strong-bg)" label="Depressed (10th–30th pct)" />
            <MmLegendSwatch bg="var(--ws-mm-heat-red-very-bg)" label="Bottom decile (≤ 10th pct) — extreme" />
          </div>
          <p className="mb-2 text-ws-caption" style={{ color: "var(--ws-text-dim)" }}>
            Hover any colored cell to see its exact value and percentile. Columns with fewer than 60
            days of history fall back to the up-vs-down rule below.
          </p>

          <p className="mb-1 text-ws-caption font-semibold" style={{ color: "var(--ws-text)" }}>
            Up/Down fallback
          </p>
          <p className="mb-2 text-ws-caption" style={{ color: "var(--ws-text-dim)" }}>
            Green when the up count leads, red when the down count leads. The shade deepens when one
            side is ≥ 78% of the pair; equal counts stay uncolored.
          </p>

          <p className="mb-1 text-ws-caption font-semibold" style={{ color: "var(--ws-text)" }}>
            5D &amp; 10D Ratio
          </p>
          <p className="mb-2 text-ws-caption" style={{ color: "var(--ws-text-dim)" }}>
            Fixed thresholds — deep red &lt; 0.5, red 0.5–1, green 1–2, deep green &gt; 2. A ratio of 1
            is neutral.
          </p>

          <p className="mb-1 text-ws-caption font-semibold" style={{ color: "var(--ws-text)" }}>
            Not color-coded
          </p>
          <p className="text-ws-caption" style={{ color: "var(--ws-text-dim)" }}>
            7× ATR, EP, and Stock Universe show raw counts only.
          </p>
        </div>,
        document.body
      )}
    </span>
  );
}

export default function MarketLeftPanel({
  onSymbolSelect,
  onWatchlistListCreated,
}: {
  onSymbolSelect?: (sym: string) => void;
  onWatchlistListCreated?: (info: MarketMonitorListCreatedInfo) => void;
}) {
  return (
    <div
      className="h-full min-h-0 flex flex-col overflow-x-auto overflow-y-hidden"
      style={{ background: "var(--ws-bg2)" }}
    >
      <div className="flex min-w-max flex-col h-full min-h-0">
        <div className="flex min-h-0 min-w-max flex-1 flex-col overflow-y-auto">
          <div
            className="sticky left-0 z-10 flex shrink-0 items-center justify-center px-3 py-2"
            style={{ background: "var(--ws-bg2)", borderBottom: "1px solid var(--ws-border)", width: "min(92vw, 1600px)" }}
          >
            <span className="inline-flex items-center gap-1.5">
              <span
                className="text-ws-label font-semibold uppercase tracking-wide"
                style={{ color: "var(--ws-cyan)" }}
              >
                Market Monitor
              </span>
              <MarketMonitorColorInfo />
            </span>
          </div>
          <MarketMonitorTable onSymbolSelect={onSymbolSelect} onWatchlistListCreated={onWatchlistListCreated} />
        </div>
      </div>
    </div>
  );
}
