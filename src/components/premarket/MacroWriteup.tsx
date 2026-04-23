"use client";

import type { DailyMacroWriteupRow } from "@/types/newsletter-macro";
import { formatYmdDisplay } from "@/lib/et-ymd";

export type MacroWriteupProps = {
  loading: boolean;
  error: string | null;
  row: DailyMacroWriteupRow | null;
  ymd: string | null;
};

export default function MacroWriteup({ loading, error, row, ymd }: MacroWriteupProps) {
  if (loading) {
    return (
      <p style={{ color: "var(--text-secondary)", fontSize: "var(--fs-11)" }}>
        Loading macro writeup…
      </p>
    );
  }

  if (error) {
    return (
      <p role="alert" style={{ color: "var(--warning)", fontSize: "var(--fs-11)" }}>
        {error}
      </p>
    );
  }

  if (!row?.writeup_text?.trim()) {
    return (
      <div
        className="rounded border px-3 py-2"
        style={{
          borderColor: "var(--border-default)",
          background: "var(--bg-inset)",
          boxShadow: "inset 2px 0 0 0 var(--accent-cyan)",
        }}
      >
        <div className="mb-1">
          <span className="font-semibold uppercase tracking-[var(--letter-label)]" style={{ fontSize: "var(--fs-9)", color: "var(--accent-cyan)" }}>
            Macro
          </span>
        </div>
        <p style={{ color: "var(--text-secondary)", fontSize: "var(--fs-11)" }}>
          No macro writeup for {ymd ? formatYmdDisplay(ymd) : "today"} yet.
        </p>
        <p className="mt-1" style={{ color: "var(--text-tertiary)", fontSize: "var(--fs-9)" }}>
          After Gmail + crons, check ~7:10 AM ET on market days — or run ingest locally.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {row.fallback_used ? (
        <p
          className="rounded border px-2 py-1.5"
          style={{
            borderColor: "rgba(251, 191, 36, 0.35)",
            background: "var(--accent-amber-muted)",
            color: "var(--accent-amber)",
            fontSize: "var(--fs-10)",
          }}
        >
          Web search fallback (no morning newsletters in the 4–7 AM ET window).
        </p>
      ) : null}
      <div
        className="rounded border px-3 py-2"
        style={{
          borderColor: "var(--border-default)",
          background: "var(--bg-inset)",
          boxShadow: "inset 2px 0 0 0 var(--accent-cyan)",
        }}
      >
        <div className="mb-1.5">
          <span className="font-semibold uppercase tracking-[var(--letter-label)]" style={{ fontSize: "var(--fs-9)", color: "var(--accent-cyan)" }}>
            Macro
          </span>
        </div>
        <p className="max-h-[8.5rem] overflow-hidden leading-relaxed" style={{ color: "var(--text-primary)", fontSize: "var(--fs-11)" }} title={row.writeup_text.trim()}>
          {row.writeup_text.trim().length > 520 ? `${row.writeup_text.trim().slice(0, 520)}…` : row.writeup_text.trim()}
        </p>
      </div>
    </div>
  );
}
