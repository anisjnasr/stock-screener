"use client";

import { useRef, useCallback, useState, type ReactNode } from "react";

type WorkspaceLayoutProps = {
  chartLeftPx: number;
  onChartLeftChange?: (px: number) => void;
  railWidthPx: number;
  onRailWidthChange: (px: number) => void;
  rightRailHidden: boolean;
  onToggleRightRail?: () => void;
  leftPanel: ReactNode;
  centerPanel: ReactNode;
  rightPanel: ReactNode;
};

const HANDLE_PX = 8;
const RIGHT_DIVIDER_PX = 2;
const SLIDE_TRANSITION = "150ms cubic-bezier(0.16, 1, 0.3, 1)";

export default function WorkspaceLayout({
  chartLeftPx,
  onChartLeftChange,
  railWidthPx,
  onRailWidthChange,
  rightRailHidden,
  onToggleRightRail,
  leftPanel,
  centerPanel,
  rightPanel,
}: WorkspaceLayoutProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [draggingChart, setDraggingChart] = useState(false);

  const containerWidth = () => containerRef.current?.clientWidth ?? 1200;
  const railTotal = rightRailHidden ? 0 : RIGHT_DIVIDER_PX + railWidthPx;
  const chartIsMaximized = chartLeftPx > containerWidth();
  const effectiveChartLeft = chartIsMaximized
    ? containerWidth() - railTotal
    : chartLeftPx;

  const startDragChartLeft = useCallback(
    (e: React.MouseEvent) => {
      if (!onChartLeftChange) return;
      e.preventDefault();
      const startX = e.clientX;
      const startLeft = chartLeftPx;

      const onMove = (ev: MouseEvent) => {
        const delta = ev.clientX - startX;
        const cw = containerWidth();
        const maxLeft = cw - railTotal - HANDLE_PX;
        let next = startLeft + delta;
        next = Math.max(0, Math.min(next, maxLeft));
        onChartLeftChange(next);
      };

      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        setDraggingChart(false);
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      setDraggingChart(true);
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [chartLeftPx, onChartLeftChange, railTotal]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!onChartLeftChange) return;
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      const cw = containerWidth();
      const maxLeft = cw - railTotal - HANDLE_PX;
      const delta = e.key === "ArrowRight" ? 20 : -20;
      let next = chartLeftPx + delta;
      next = Math.max(0, Math.min(next, maxLeft));
      onChartLeftChange(next);
    },
    [chartLeftPx, onChartLeftChange, railTotal]
  );

  return (
    <div
      ref={containerRef}
      className="flex-1 min-h-0 overflow-hidden relative"
      style={{ background: "var(--ws-bg)" }}
    >
      {/* Chart layer — always full width from left edge to right panel, never resizes */}
      <div
        className="absolute top-0 bottom-0"
        style={{
          left: 0,
          right: railTotal,
          zIndex: 5,
          transition: `right ${SLIDE_TRANSITION}`,
          willChange: "right",
        }}
      >
        {centerPanel}
      </div>

      {/* Left panel overlay — sits on top of chart, clipped to drag handle position */}
      <div
        className="absolute top-0 bottom-0 left-0 overflow-hidden"
        style={{
          width: effectiveChartLeft,
          zIndex: 10,
          transition: draggingChart ? "none" : `width ${SLIDE_TRANSITION}`,
        }}
      >
        <div
          className="h-full min-h-0 overflow-hidden"
          style={{
            width: `calc(100vw - ${railTotal}px)`,
            minWidth: `calc(100vw - ${railTotal}px)`,
            transition: `width ${SLIDE_TRANSITION}, min-width ${SLIDE_TRANSITION}`,
            willChange: "width",
          }}
        >
          {leftPanel}
        </div>
      </div>

      {/* Chart left drag handle — controls the boundary between table and chart */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize chart left edge"
        tabIndex={onChartLeftChange ? 0 : -1}
        className="absolute top-0 bottom-0 cursor-col-resize flex items-center justify-center transition-opacity"
        style={{
          left: effectiveChartLeft,
          width: HANDLE_PX,
          zIndex: 20,
          background: draggingChart ? "var(--ws-cyan)" : "var(--ws-border)",
          opacity: chartIsMaximized ? 0 : draggingChart ? 0.8 : 0.7,
          pointerEvents: chartIsMaximized ? "none" : undefined,
          transition: draggingChart
            ? "none"
            : `left ${SLIDE_TRANSITION}, opacity ${SLIDE_TRANSITION}`,
        }}
        onMouseDown={onChartLeftChange ? startDragChartLeft : undefined}
        onKeyDown={handleKeyDown}
      >
        <div className="flex flex-col items-center gap-[3px]">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="rounded-full"
              style={{ width: 6, height: 3, background: "rgba(255,255,255,0.35)" }}
            />
          ))}
        </div>
      </div>

      {/* Right panel toggle button */}
      {onToggleRightRail && (
        <button
          type="button"
          onClick={onToggleRightRail}
          className="absolute top-1/2 -translate-y-1/2 flex items-center justify-center rounded-l hover:brightness-125"
          style={{
            right: rightRailHidden ? 0 : RIGHT_DIVIDER_PX + railWidthPx,
            width: 16,
            height: 48,
            zIndex: 25,
            background: "var(--ws-bg3)",
            border: "1px solid var(--ws-border)",
            borderRight: rightRailHidden ? "1px solid var(--ws-border)" : "none",
            color: "var(--ws-text-dim)",
            cursor: "pointer",
            transition: `right ${SLIDE_TRANSITION}`,
          }}
          title={rightRailHidden ? "Open right panel" : "Collapse right panel"}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
            {rightRailHidden ? (
              <path d="M7 1L3 5l4 4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            ) : (
              <path d="M3 1l4 4-4 4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            )}
          </svg>
        </button>
      )}

      {/* Right rail area — fixed width on the right, slides in/out */}
      <div
        className="absolute top-0 bottom-0 right-0 flex"
        style={{
          width: RIGHT_DIVIDER_PX + railWidthPx,
          zIndex: 20,
          transform: rightRailHidden ? "translateX(100%)" : "translateX(0)",
          transition: `transform ${SLIDE_TRANSITION}`,
          willChange: "transform",
        }}
      >
        {/* Right panel divider */}
        <div
          className="shrink-0"
          style={{
            width: RIGHT_DIVIDER_PX,
            background: "var(--ws-border)",
            opacity: 0.4,
          }}
        />

        {/* Right rail content */}
        <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
          {rightPanel}
        </div>
      </div>
    </div>
  );
}
