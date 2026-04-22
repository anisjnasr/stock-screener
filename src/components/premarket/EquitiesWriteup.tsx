"use client";

import type { DailyEquitiesWriteupRow } from "@/types/newsletter-macro";

export type EquitiesWriteupProps = {
  loading: boolean;
  error: string | null;
  row: DailyEquitiesWriteupRow | null;
  ymd: string | null;
  /** Shown when Supabase tables are not migrated yet */
  setupHint?: string | null;
};

export default function EquitiesWriteup({ loading, error, row, ymd, setupHint }: EquitiesWriteupProps) {
  if (loading) {
    return (
      <p className="text-sm leading-relaxed" style={{ color: "var(--ws-text-dim)" }}>
        Loading US equities writeup…
      </p>
    );
  }

  if (error) {
    return (
      <p className="text-sm leading-relaxed" role="alert" style={{ color: "#f59e0b" }}>
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
            className="rounded border px-2 py-1.5 text-xs leading-snug"
            role="note"
            style={{
              borderColor: "rgba(245, 158, 11, 0.45)",
              background: "rgba(245, 158, 11, 0.08)",
              color: "#fbbf24",
            }}
          >
            {setupHint}
          </p>
        ) : null}
        <div
          className="border-l-4 pl-3 text-sm leading-relaxed"
          style={{ borderColor: "var(--ws-cyan)", color: "var(--ws-text-dim)" }}
        >
          <p>No US equities writeup for {ymd ?? "today"} yet.</p>
          <p className="mt-1 text-xs">
            Runs after morning newsletters (or web-search fallback). Schedule the equities-writeup cron after macro.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {row?.fallback_used ? (
        <p
          className="rounded border px-2 py-1.5 text-xs leading-snug"
          style={{
            borderColor: "rgba(245, 158, 11, 0.45)",
            background: "rgba(245, 158, 11, 0.08)",
            color: "#fbbf24",
          }}
        >
          This writeup used <strong>web search</strong> (no morning newsletters were ingested for the 4–7 AM ET window).
        </p>
      ) : null}
      <div
        className="border-l-4 pl-3 text-[11.5px] leading-relaxed sm:text-xs"
        style={{ borderColor: "var(--ws-cyan)", color: "var(--ws-text)" }}
      >
        <ul className="list-disc space-y-1.5 pl-4">
          {bullets.map((b, i) => (
            <li key={i} className="whitespace-pre-wrap">
              {b.trim()}
            </li>
          ))}
        </ul>
        {row ? (
          <p className="mt-2 text-[10px] tabular-nums" style={{ color: "var(--ws-text-vdim)" }}>
            {row.fallback_used ? "Source: web search · " : null}
            Model {row.model_used} · {new Date(row.generated_at).toLocaleString("en-US", { timeZone: "America/New_York" })}{" "}
            ET
          </p>
        ) : null}
      </div>
    </div>
  );
}
