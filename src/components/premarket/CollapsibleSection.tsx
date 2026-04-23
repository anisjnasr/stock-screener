"use client";

import { useId, type ReactNode } from "react";

export type CollapsibleLabelAccent = "cyan" | "amber" | "default";

export type CollapsibleSectionProps = {
  /** Stable id for layout storage + scroll targets */
  id: string;
  label: string;
  labelAccent?: CollapsibleLabelAccent;
  /** Shown in header when expanded (hidden when collapsed) */
  metadata?: string;
  peekText: string;
  collapsed: boolean;
  onToggle: () => void;
  actions?: ReactNode;
  headerLegend?: ReactNode;
  children: ReactNode;
};

export default function CollapsibleSection({
  id,
  label,
  labelAccent = "default",
  metadata,
  peekText,
  collapsed,
  onToggle,
  actions,
  headerLegend,
  children,
}: CollapsibleSectionProps) {
  const uid = useId();
  const panelId = `premarket-panel-${id}-${uid}`;
  const headerId = `premarket-header-${id}-${uid}`;

  const accentColor =
    labelAccent === "cyan"
      ? "var(--accent-cyan)"
      : labelAccent === "amber"
        ? "var(--accent-amber)"
        : "var(--text-primary)";

  return (
    <section
      data-premarket-section={id}
      className="min-w-0 rounded border transition-colors"
      style={{
        borderColor: "var(--border-default)",
        background: "var(--bg-panel)",
        borderRadius: "var(--radius-md)",
      }}
    >
      <div
        className="flex min-w-0 items-stretch gap-0 border-b"
        style={{ borderColor: "var(--border-default)" }}
      >
        <button
          type="button"
          id={headerId}
          role="button"
          aria-expanded={!collapsed}
          aria-controls={panelId}
          className="pm-focus flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[color:var(--bg-elevated)]"
          style={{ color: "var(--text-primary)" }}
          onClick={onToggle}
        >
          <span
            className="pm-mono inline-flex w-3 shrink-0 justify-center leading-none transition-transform duration-300 ease-out"
            style={{
              fontSize: "var(--fs-8)",
              color: "var(--text-tertiary)",
              transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
            }}
            aria-hidden
          >
            ▼
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
            <span
              className="shrink-0 font-semibold uppercase tracking-[var(--letter-label)]"
              style={{ fontSize: "var(--fs-10)", color: accentColor, letterSpacing: "var(--letter-label)" }}
            >
              {label}
            </span>
            {!collapsed && metadata ? (
              <span
                className="min-w-0 truncate font-medium"
                style={{ fontSize: "var(--fs-9)", color: "var(--text-tertiary)" }}
              >
                {metadata}
              </span>
            ) : null}
            {collapsed && peekText ? (
              <span
                className="min-w-0 flex-1 truncate text-right font-medium leading-snug"
                style={{ fontSize: "var(--fs-10)", color: "var(--text-secondary)" }}
              >
                {peekText}
              </span>
            ) : null}
          </span>
        </button>
        <div
          className="flex shrink-0 items-center gap-2 border-l px-2"
          style={{ borderColor: "var(--border-default)" }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {actions ? <div className="flex items-center gap-1.5">{actions}</div> : null}
          {headerLegend ? (
            <div className="flex max-w-[14rem] flex-wrap items-center justify-end gap-x-2 gap-y-0.5 sm:max-w-none" style={{ fontSize: "var(--fs-9)", color: "var(--text-tertiary)" }}>
              {headerLegend}
            </div>
          ) : null}
        </div>
      </div>
      <div
        id={panelId}
        role="region"
        aria-labelledby={headerId}
        aria-hidden={collapsed}
        className="overflow-hidden transition-[max-height,opacity] duration-300 ease-out"
        style={{
          maxHeight: collapsed ? 0 : 4000,
          opacity: collapsed ? 0 : 1,
        }}
      >
        <div
          className="border-t px-3 transition-[padding] duration-300 ease-out"
          style={{
            borderColor: "var(--border-default)",
            color: "var(--text-secondary)",
            fontSize: "var(--fs-11)",
            paddingTop: collapsed ? 0 : 12,
            paddingBottom: collapsed ? 0 : 12,
            pointerEvents: collapsed ? "none" : "auto",
          }}
        >
          {children}
        </div>
      </div>
    </section>
  );
}
