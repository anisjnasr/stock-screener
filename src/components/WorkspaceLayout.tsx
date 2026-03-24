"use client";

import { useRef, useCallback, type ReactNode } from "react";

type WorkspaceLayoutProps = {
  chartLeftPx: number;
  onChartLeftChange: (px: number) => void;
  railWidthPx: number;
  onRailWidthChange: (px: number) => void;
  rightRailHidden: boolean;
  leftPanel: ReactNode;
  centerPanel: ReactNode;
  rightPanel: ReactNode;
};

const MIN_TABLE = 200;
const MAX_TABLE = 600;
const MIN_CHART = 300;
const MIN_RAIL = 200;
const MAX_RAIL = 400;

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

  const startDragLeft = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = chartLeftPx;

      const onMove = (ev: MouseEvent) => {
        const delta = ev.clientX - startX;
        const next = Math.max(MIN_TABLE, Math.min(MAX_TABLE, startWidth + delta));
        const containerWidth = containerRef.current?.clientWidth ?? 1200;
        const railW = rightRailHidden ? 0 : railWidthPx;
        if (containerWidth - next - railW < MIN_CHART) return;
        onChartLeftChange(next);
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
    [chartLeftPx, onChartLeftChange, railWidthPx, rightRailHidden]
  );

  const startDragRight = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = railWidthPx;

      const onMove = (ev: MouseEvent) => {
        const delta = startX - ev.clientX;
        const next = Math.max(MIN_RAIL, Math.min(MAX_RAIL, startWidth + delta));
        const containerWidth = containerRef.current?.clientWidth ?? 1200;
        if (containerWidth - chartLeftPx - next < MIN_CHART) return;
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
    [railWidthPx, onRailWidthChange, chartLeftPx]
  );

  const railW = rightRailHidden ? 0 : railWidthPx;
  const gridTemplate = `${chartLeftPx}px 4px 1fr${rightRailHidden ? "" : ` 4px ${railW}px`}`;

  return (
    <div
      ref={containerRef}
      className="flex-1 min-h-0 overflow-hidden"
      style={{
        display: "grid",
        gridTemplateColumns: gridTemplate,
        gridTemplateRows: "1fr",
        background: "var(--ws-bg)",
      }}
    >
      {/* Left table panel */}
      <div className="min-h-0 min-w-0 overflow-hidden">{leftPanel}</div>

      {/* Left drag handle */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize table width"
        tabIndex={0}
        className="cursor-col-resize flex items-center justify-center hover:opacity-100 transition-opacity"
        style={{
          background: "var(--ws-border)",
          opacity: 0.5,
        }}
        onMouseDown={startDragLeft}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") onChartLeftChange(Math.max(MIN_TABLE, chartLeftPx - 20));
          if (e.key === "ArrowRight") onChartLeftChange(Math.min(MAX_TABLE, chartLeftPx + 20));
        }}
      >
        <div
          className="w-[2px] h-8 rounded-full"
          style={{ background: "var(--ws-text-vdim)" }}
        />
      </div>

      {/* Center chart + underlay */}
      <div className="min-h-0 min-w-0 overflow-hidden">{centerPanel}</div>

      {/* Right drag handle */}
      {!rightRailHidden && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize right panel width"
          tabIndex={0}
          className="cursor-col-resize flex items-center justify-center hover:opacity-100 transition-opacity"
          style={{
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
      )}

      {/* Right rail */}
      {!rightRailHidden && (
        <div className="min-h-0 min-w-0 overflow-hidden">{rightPanel}</div>
      )}
    </div>
  );
}
