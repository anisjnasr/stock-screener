"use client";

import type { DailyEquitiesWriteupRow } from "@/types/newsletter-macro";
import { formatYmdDisplay } from "@/lib/et-ymd";

export type EquitiesWriteupProps = {
  loading: boolean;
  error: string | null;
  row: DailyEquitiesWriteupRow | null;
  ymd: string | null;
  /** Shown when Supabase tables are not migrated yet */
  setupHint?: string | null;
};

const MAX_BULLETS = 8;
const MAX_CHARS = 220;

export default function EquitiesWriteup({ loading, error, row, ymd, setupHint }: EquitiesWriteupProps) {
  if (loading) {
    return (
      <p className="pm-site-prose" style={{ color: "var(--text-secondary)" }}>
        Loading US equities writeup…
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

  const bullets = row?.bullets?.filter((b) => b.trim()) ?? [];

  if (!bullets.length) {
    return (
      <div className="space-y-2">
        {setupHint ? (
          <p
            className="pm-site-caption rounded border px-2 py-1.5"
            role="note"
            style={{
              borderColor: "rgba(251, 191, 36, 0.35)",
              background: "var(--accent-amber-muted)",
              color: "var(--accent-amber)",
            }}
          >
            {setupHint}
          </p>
        ) : null}
        <div
          className="rounded border px-3 py-2"
          style={{
            borderColor: "var(--border-default)",
            background: "var(--bg-inset)",
            boxShadow: "inset 2px 0 0 0 var(--accent-amber)",
          }}
        >
          <div className="mb-1">
            <span className="pm-section-label" style={{ color: "var(--accent-amber)" }}>
              US equities
            </span>
          </div>
          <p className="pm-site-prose" style={{ color: "var(--text-secondary)" }}>
            No US equities writeup for {ymd ? formatYmdDisplay(ymd) : "today"} yet.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {row?.fallback_used ? (
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
          boxShadow: "inset 2px 0 0 0 var(--accent-amber)",
        }}
      >
        <div className="mb-1.5">
          <span className="pm-section-label" style={{ color: "var(--accent-amber)" }}>
            US equities
          </span>
        </div>
        <ul className="pm-site-prose list-disc space-y-1 pl-4" style={{ color: "var(--text-primary)" }}>
          {bullets.slice(0, MAX_BULLETS).map((b, i) => {
            const t = b.trim();
            const short = t.length > MAX_CHARS ? `${t.slice(0, MAX_CHARS)}…` : t;
            return (
              <li key={i} className="leading-snug" title={t.length > MAX_CHARS ? t : undefined}>
                {short}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
