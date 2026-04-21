"use client";

import { useId } from "react";

export type CollapsibleSectionProps = {
  id: string;
  title: string;
  peekText: string;
  collapsed: boolean;
  onToggle: () => void;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
};

export default function CollapsibleSection({
  id,
  title,
  peekText,
  collapsed,
  onToggle,
  headerRight,
  children,
}: CollapsibleSectionProps) {
  const uid = useId();
  const panelId = `premarket-panel-${id}-${uid}`;
  const headerId = `premarket-header-${id}-${uid}`;

  return (
    <section
      data-premarket-section={id}
      className="min-w-0 rounded border transition-colors"
      style={{ borderColor: "var(--ws-border)", background: "var(--ws-bg2)" }}
    >
      <div className="flex min-w-0 items-stretch gap-2 border-b" style={{ borderColor: "var(--ws-border)" }}>
        <button
          type="button"
          id={headerId}
          aria-expanded={!collapsed}
          aria-controls={panelId}
          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left transition-colors ws-focus-ring hover:bg-[color:var(--ws-hover)]"
          style={{ color: "var(--ws-text)" }}
          onClick={onToggle}
        >
          <span
            className="inline-flex shrink-0 transition-transform duration-300 ease-out"
            style={{ transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)" }}
            aria-hidden
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" style={{ color: "var(--ws-text-dim)" }}>
              <path
                fillRule="evenodd"
                d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
                clipRule="evenodd"
              />
            </svg>
          </span>
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <span
              className="shrink-0 text-xs font-semibold uppercase tracking-wider"
              style={{ color: "var(--ws-text)" }}
            >
              {title}
            </span>
            {collapsed && peekText ? (
              <span
                className="min-w-0 flex-1 truncate text-right text-sm font-medium leading-snug transition-opacity duration-300 ease-out"
                style={{ color: "var(--ws-text-dim)" }}
              >
                {peekText}
              </span>
            ) : null}
          </span>
        </button>
        {headerRight ? <div className="flex shrink-0 items-center px-2">{headerRight}</div> : null}
      </div>
      <div
        id={panelId}
        role="region"
        aria-labelledby={headerId}
        aria-hidden={collapsed}
        className="grid transition-[grid-template-rows] duration-300 ease-out"
        style={{ gridTemplateRows: collapsed ? "0fr" : "1fr" }}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            className="border-t px-3 py-3 text-xs transition-opacity duration-300 ease-out"
            style={{
              borderColor: "var(--ws-border)",
              color: "var(--ws-text-dim)",
              opacity: collapsed ? 0 : 1,
            }}
          >
            {children}
          </div>
        </div>
      </div>
    </section>
  );
}
