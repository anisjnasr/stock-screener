"use client";

type TopBarProps = {
  onCollapseAll: () => void;
  onExpandAll: () => void;
};

export default function TopBar({ onCollapseAll, onExpandAll }: TopBarProps) {
  return (
    <div
      className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-3 py-2.5"
      style={{ borderColor: "var(--ws-border)", background: "var(--ws-bg3)" }}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--ws-text-dim)" }}>
          Pre-market desk
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onCollapseAll}
          className="rounded border px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide transition-colors ws-focus-ring hover:bg-[color:var(--ws-hover)]"
          style={{ borderColor: "var(--ws-border)", color: "var(--ws-text-dim)" }}
          aria-label="Collapse all pre-market sections"
        >
          Collapse all
        </button>
        <button
          type="button"
          onClick={onExpandAll}
          className="rounded border px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide transition-colors ws-focus-ring hover:bg-[color:var(--ws-hover)]"
          style={{ borderColor: "var(--ws-border)", color: "var(--ws-text-dim)" }}
          aria-label="Expand all pre-market sections"
        >
          Expand all
        </button>
      </div>
    </div>
  );
}
