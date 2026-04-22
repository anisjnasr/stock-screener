"use client";

import type { DailyMacroWriteupRow } from "@/types/newsletter-macro";

export type MacroWriteupProps = {
  loading: boolean;
  error: string | null;
  row: DailyMacroWriteupRow | null;
  ymd: string | null;
};

export default function MacroWriteup({ loading, error, row, ymd }: MacroWriteupProps) {
  if (loading) {
    return (
      <p className="text-sm leading-relaxed" style={{ color: "var(--ws-text-dim)" }}>
        Loading macro writeup…
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

  if (!row?.writeup_text?.trim()) {
    return (
      <div
        className="border-l-4 pl-3 text-sm leading-relaxed"
        style={{ borderColor: "var(--ws-cyan)", color: "var(--ws-text-dim)" }}
      >
        <p>No macro writeup for {ymd ?? "today"} yet.</p>
        <p className="mt-1 text-xs">
          After you wire Gmail and crons, check back around <span className="tabular-nums">7:10 AM ET</span> on market
          days — or run the ingest + macro cron triggers locally.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {row.fallback_used ? (
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
        <p className="whitespace-pre-wrap">{row.writeup_text.trim()}</p>
        <p className="mt-2 text-[10px] tabular-nums" style={{ color: "var(--ws-text-vdim)" }}>
          {row.fallback_used ? "Source: web search · " : null}
          Model {row.model_used} · {new Date(row.generated_at).toLocaleString("en-US", { timeZone: "America/New_York" })}{" "}
          ET
        </p>
      </div>
    </div>
  );
}
