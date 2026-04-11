"use client";
/* eslint-disable react-hooks/refs */

import { useRef, useCallback, useState, type ReactNode } from "react";
import { DEFAULT_RAIL_WIDTH_PX } from "@/lib/layout-constants";

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
const MIN_CENTER_WIDTH_PX = 420;
const MIN_RAIL_WIDTH_PX = DEFAULT_RAIL_WIDTH_PX;
type ActivePane = "left" | "center" | "right";

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
  const [draggingRail, setDraggingRail] = useState(false);
  const [hoveringChartHandle, setHoveringChartHandle] = useState(false);
  const [hoveringRailHandle, setHoveringRailHandle] = useState(false);
  const [activePane, setActivePane] = useState<ActivePane>("center");

  const containerWidth = () => {
    const w = containerRef.current?.clientWidth;
    if (w != null && w > 0) return w;
    if (typeof window !== "undefined" && window.innerWidth > 0) return window.innerWidth;
    return 1200;
  };
  const railTotal = rightRailHidden ? 0 : RIGHT_DIVIDER_PX + railWidthPx;
  const chartIsMaximized = chartLeftPx > containerWidth();
  const effectiveChartLeft = chartIsMaximized
    ? containerWidth() - railTotal
    : chartLeftPx;
  /**
   * When the chart is maximized (e.g. Market Monitor), pin the left overlay to the container width.
   * Using only `effectiveChartLeft` in px can fall back to 1200 or a stale ref width, leaving a strip
   * of the chart visible on the right. `calc(100% - rail)` tracks the real layout width.
   */
  const leftOverlayWidth: number | string = chartIsMaximized
    ? `calc(100% - ${railTotal}px)`
    : effectiveChartLeft;
  /** Handle sits at the right edge of the left overlay (before the right rail when open). */
  const chartResizeHandleLeft: number | string = chartIsMaximized
    ? `calc(100% - ${railTotal + HANDLE_PX}px)`
    : effectiveChartLeft;
  /** Chart starts after the divider unless maximized (overlay eats almost full width; keep chart full-bleed under it). */
  const chartColumnLeft = chartIsMaximized ? 0 : effectiveChartLeft + HANDLE_PX;

  const startDragChartLeft = useCallback(
    (e: React.MouseEvent) => {
      if (!onChartLeftChange) return;
      e.preventDefault();
      const startX = e.clientX;
      const startLeft = chartLeftPx;

      const onMove = (ev: MouseEvent) => {
        const delta = ev.clientX - startX;
        const cw = containerWidth();
        const maxLeft = Math.max(0, cw - railTotal - HANDLE_PX - MIN_CENTER_WIDTH_PX);
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
      const maxLeft = Math.max(0, cw - railTotal - HANDLE_PX - MIN_CENTER_WIDTH_PX);
      const delta = e.key === "ArrowRight" ? 20 : -20;
      let next = chartLeftPx + delta;
      next = Math.max(0, Math.min(next, maxLeft));
      onChartLeftChange(next);
    },
    [chartLeftPx, onChartLeftChange, railTotal]
  );

  const startDragRailWidth = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = railWidthPx;
      const onMove = (ev: MouseEvent) => {
        const delta = startX - ev.clientX;
        const cw = containerWidth();
        const maxWidth = Math.max(MIN_RAIL_WIDTH_PX, Math.floor(cw / 2));
        const next = Math.max(MIN_RAIL_WIDTH_PX, Math.min(maxWidth, startWidth + delta));
        onRailWidthChange(next);
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        setDraggingRail(false);
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      setDraggingRail(true);
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [onRailWidthChange, railWidthPx]
  );

  return (
    <div
      ref={containerRef}
      className="flex-1 min-h-0 overflow-hidden relative"
      style={{ background: "var(--ws-bg)" }}
    >
      {/* Chart layer — always full width from left edge to right panel, never resizes */}
      <div
        className="ws-pane ws-chart-column absolute top-0 bottom-0 min-h-0"
        style={{
          left: chartColumnLeft,
          right: railTotal,
          zIndex: 5,
          transition: draggingChart
            ? "none"
            : `left ${SLIDE_TRANSITION}, right ${SLIDE_TRANSITION}`,
          willChange: "left",
        }}
        onPointerDownCapture={() => setActivePane("center")}
      >
        <div className="ws-chart-pane-inner relative h-full min-h-0 overflow-hidden">{centerPanel}</div>
        <div
          className={`ws-pane-frame ${activePane === "center" ? "is-active" : ""}`}
          aria-hidden
        />
      </div>

      {/* Left panel overlay — sits on top of chart, clipped to drag handle position */}
      <div
        className="ws-pane absolute top-0 bottom-0 left-0 overflow-hidden"
        style={{
          width: leftOverlayWidth,
          /* Opaque fill so the chart layer (below z-index) never shows through gaps from child max-width, padding, etc. */
          background: "var(--ws-bg2)",
          /* Above chart-left handle (20) so fixed modals from the panel (e.g. Edit Scan) stack on top of the divider. */
          zIndex: 30,
          transition: draggingChart ? "none" : `width ${SLIDE_TRANSITION}`,
          borderRight:
            chartIsMaximized && railTotal === 0 ? "none" : "1px solid var(--ws-border)",
        }}
        onPointerDownCapture={() => setActivePane("left")}
      >
        <div
          className="h-full min-h-0 min-w-0 overflow-x-auto overflow-y-hidden"
          style={{
            width: "100%",
            transition: draggingChart ? "none" : `width ${SLIDE_TRANSITION}`,
          }}
        >
          {leftPanel}
        </div>
        <div
          className={`ws-pane-frame ${activePane === "left" ? "is-active" : ""}`}
          aria-hidden
        />
      </div>

      {/* Chart left drag handle — controls the boundary between table and chart */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize chart left edge"
        tabIndex={onChartLeftChange ? 0 : -1}
        className="absolute top-0 bottom-0 cursor-col-resize flex items-center justify-center transition-opacity"
        style={{
          left: chartResizeHandleLeft,
          width: HANDLE_PX,
          zIndex: 20,
          background: draggingChart || hoveringChartHandle ? "var(--ws-cyan)" : "var(--ws-border)",
          opacity: chartIsMaximized ? 0 : draggingChart ? 0.8 : hoveringChartHandle ? 0.65 : 0.7,
          pointerEvents: chartIsMaximized ? "none" : undefined,
          transition: draggingChart
            ? "none"
            : `left ${SLIDE_TRANSITION}, opacity ${SLIDE_TRANSITION}`,
        }}
        onMouseEnter={() => setHoveringChartHandle(true)}
        onMouseLeave={() => setHoveringChartHandle(false)}
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
        {/* Right rail drag handle — mirrors chart-left handle visuals */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize right panel"
          tabIndex={0}
          className="absolute top-0 bottom-0 left-0 cursor-col-resize flex items-center justify-center transition-opacity"
          style={{
            width: HANDLE_PX,
            zIndex: 22,
            background: draggingRail || hoveringRailHandle ? "var(--ws-cyan)" : "var(--ws-border)",
            opacity: draggingRail ? 0.8 : hoveringRailHandle ? 0.65 : 0.7,
            transition: draggingRail ? "none" : `opacity ${SLIDE_TRANSITION}`,
          }}
          onMouseEnter={() => setHoveringRailHandle(true)}
          onMouseLeave={() => setHoveringRailHandle(false)}
          onMouseDown={startDragRailWidth}
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
        <div
          className="ws-pane relative flex-1 min-h-0 min-w-0 overflow-hidden"
          onPointerDownCapture={() => setActivePane("right")}
        >
          {rightPanel}
          <div
            className={`ws-pane-frame ${activePane === "right" ? "is-active" : ""}`}
            aria-hidden
          />
        </div>
      </div>
    </div>
  );
}
