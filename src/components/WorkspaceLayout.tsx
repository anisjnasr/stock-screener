"use client";

import { useRef, useCallback, useState, type ReactNode } from "react";

type WorkspaceLayoutProps = {
  chartLeftPx: number;
  onChartLeftChange?: (px: number) => void;
  railWidthPx: number;
  onRailWidthChange: (px: number) => void;
  rightRailHidden: boolean;
  leftPanel: ReactNode;
  centerPanel: ReactNode;
  rightPanel: ReactNode;
};

const MIN_RAIL = 200;
const MAX_RAIL = 400;
const HANDLE_PX = 4;

export default function WorkspaceLayout({
  chartLeftPx,
  onChartLeftChange,
  railWidthPx,
  onRailWidthChange,
  rightRailHidden,
  leftPanel,
  centerPanel,
  rightPanel,
}: WorkspaceLayoutProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [draggingChart, setDraggingChart] = useState(false);

  const containerWidth = () => containerRef.current?.clientWidth ?? 1200;
  const railTotal = rightRailHidden ? 0 : HANDLE_PX + railWidthPx;

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

  const startDragRight = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = railWidthPx;

      const onMove = (ev: MouseEvent) => {
        const delta = startX - ev.clientX;
        const next = Math.max(MIN_RAIL, Math.min(MAX_RAIL, startWidth + delta));
        onRailWidthChange(next);
      };

      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [railWidthPx, onRailWidthChange]
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
        }}
      >
        {centerPanel}
      </div>

      {/* Left panel overlay — sits on top of chart, clipped to drag handle position */}
      <div
        className="absolute top-0 bottom-0 left-0 overflow-hidden"
        style={{
          width: chartLeftPx,
          zIndex: 10,
        }}
      >
        <div
          className="h-full min-h-0 overflow-hidden"
          style={{ width: `calc(100vw - ${railTotal}px)`, minWidth: `calc(100vw - ${railTotal}px)` }}
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
          left: chartLeftPx,
          width: HANDLE_PX,
          zIndex: 20,
          background: draggingChart ? "var(--ws-cyan)" : "var(--ws-border)",
          opacity: draggingChart ? 0.8 : 0.5,
        }}
        onMouseDown={onChartLeftChange ? startDragChartLeft : undefined}
        onKeyDown={handleKeyDown}
      >
        <div
          className="w-[2px] h-8 rounded-full"
          style={{ background: "var(--ws-text-vdim)" }}
        />
      </div>

      {/* Right rail area — fixed width on the right */}
      {!rightRailHidden && (
        <div
          className="absolute top-0 bottom-0 right-0 flex"
          style={{ width: HANDLE_PX + railWidthPx, zIndex: 20 }}
        >
          {/* Right drag handle */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize right panel width"
            tabIndex={0}
            className="shrink-0 cursor-col-resize flex items-center justify-center hover:opacity-100 transition-opacity"
            style={{
              width: HANDLE_PX,
              background: "var(--ws-border)",
              opacity: 0.5,
            }}
            onMouseDown={startDragRight}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") onRailWidthChange(Math.max(MIN_RAIL, railWidthPx - 20));
              if (e.key === "ArrowLeft") onRailWidthChange(Math.min(MAX_RAIL, railWidthPx + 20));
            }}
          >
            <div
              className="w-[2px] h-8 rounded-full"
              style={{ background: "var(--ws-text-vdim)" }}
            />
          </div>

          {/* Right rail content */}
          <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
            {rightPanel}
          </div>
        </div>
      )}
    </div>
  );
}
