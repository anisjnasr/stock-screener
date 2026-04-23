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

const MAX_BULLETS = 4;
const MAX_CHARS = 220;

export default function EquitiesWriteup({ loading, error, row, ymd, setupHint }: EquitiesWriteupProps) {
  if (loading) {
    return (
      <p style={{ color: "var(--text-secondary)", fontSize: "var(--fs-11)" }}>
        Loading US equities writeup…
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

  const bullets = row?.bullets?.filter((b) => b.trim()) ?? [];

  if (!bullets.length) {
    return (
      <div className="space-y-2">
        {setupHint ? (
          <p
            className="rounded border px-2 py-1.5"
            role="note"
            style={{
              borderColor: "rgba(251, 191, 36, 0.35)",
              background: "var(--accent-amber-muted)",
              color: "var(--accent-amber)",
              fontSize: "var(--fs-10)",
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
            <span className="font-semibold uppercase tracking-[var(--letter-label)]" style={{ fontSize: "var(--fs-9)", color: "var(--accent-amber)" }}>
              US equities
            </span>
          </div>
          <p style={{ color: "var(--text-secondary)", fontSize: "var(--fs-11)" }}>
            No US equities writeup for {ymd ? formatYmdDisplay(ymd) : "today"} yet.
          </p>
          <p className="mt-1" style={{ color: "var(--text-tertiary)", fontSize: "var(--fs-9)" }}>
            Runs after morning newsletters (or web-search fallback).
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {row?.fallback_used ? (
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
          boxShadow: "inset 2px 0 0 0 var(--accent-amber)",
        }}
      >
        <div className="mb-1.5">
          <span className="font-semibold uppercase tracking-[var(--letter-label)]" style={{ fontSize: "var(--fs-9)", color: "var(--accent-amber)" }}>
            US equities
          </span>
        </div>
        <ul className="list-disc space-y-1 pl-4" style={{ color: "var(--text-primary)", fontSize: "var(--fs-11)" }}>
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
