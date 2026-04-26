"use client";

import type { DailyMacroWriteupRow } from "@/types/newsletter-macro";
import { formatYmdDisplay } from "@/lib/et-ymd";

const MAX_MACRO_SENTENCES = 8;

/** First `max` sentences (split after . ! ? + whitespace); no character cap. */
function takeFirstSentences(text: string, max: number): { display: string; truncated: boolean } {
  const full = text.trim();
  if (!full) return { display: "", truncated: false };
  const parts = full.split(/(?<=[.!?])\s+/).filter((p) => p.length > 0);
  if (parts.length === 0) return { display: full, truncated: false };
  if (parts.length <= max) return { display: full, truncated: false };
  return { display: `${parts.slice(0, max).join(" ")}…`, truncated: true };
}

export type MacroWriteupProps = {
  loading: boolean;
  error: string | null;
  row: DailyMacroWriteupRow | null;
  ymd: string | null;
};

export default function MacroWriteup({ loading, error, row, ymd }: MacroWriteupProps) {
  if (loading) {
    return (
      <p className="pm-site-prose" style={{ color: "var(--text-secondary)" }}>
        Loading macro writeup…
      </p>
    );
  }

  if (error) {
    return (
      <p className="pm-site-prose" role="alert" style={{ color: "var(--warning)" }}>
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
          <span className="pm-section-label" style={{ color: "var(--accent-cyan)" }}>
            Macro
          </span>
        </div>
        <p className="pm-site-prose" style={{ color: "var(--text-secondary)" }}>
          No macro writeup for {ymd ? formatYmdDisplay(ymd) : "today"} yet.
        </p>
      </div>
    );
  }

  const { display, truncated } = takeFirstSentences(row.writeup_text, MAX_MACRO_SENTENCES);

  return (
    <div className="space-y-2">
      {row.fallback_used ? (
        <p
          className="pm-site-caption rounded border px-2 py-1.5"
          style={{
            borderColor: "rgba(251, 191, 36, 0.35)",
            background: "var(--accent-amber-muted)",
            color: "var(--accent-amber)",
          }}
        >
          Web search fallback (no current newsletters archived in the last 2 days).
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
          <span className="pm-section-label" style={{ color: "var(--accent-cyan)" }}>
            Macro
          </span>
        </div>
        <p
          className="pm-site-prose"
          style={{ color: "var(--text-primary)" }}
          title={truncated ? row.writeup_text.trim() : undefined}
        >
          {display}
        </p>
      </div>
    </div>
  );
}
