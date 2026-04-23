"use client";

import { useEffect, useState } from "react";

type MarketPhase = "PRE-MARKET" | "MARKET OPEN" | "AFTER-HOURS" | "MARKET CLOSED";

function etParts(d: Date): { weekday: string; hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = get("weekday");
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  return { weekday, hour: Number.isFinite(hour) ? hour : 0, minute: Number.isFinite(minute) ? minute : 0 };
}

function marketPhaseFor(now: Date): { phase: MarketPhase; dotColor: string } {
  const { weekday, hour, minute } = etParts(now);
  const wd = weekday.toLowerCase();
  if (wd === "saturday" || wd === "sunday") {
    return { phase: "MARKET CLOSED", dotColor: "var(--text-tertiary)" };
  }
  const mins = hour * 60 + minute;
  const preStart = 4 * 60;
  const openStart = 9 * 60 + 30;
  const closeStart = 16 * 60;
  const afterEnd = 20 * 60;
  if (mins >= preStart && mins < openStart) {
    return { phase: "PRE-MARKET", dotColor: "var(--accent-cyan)" };
  }
  if (mins >= openStart && mins < closeStart) {
    return { phase: "MARKET OPEN", dotColor: "var(--positive)" };
  }
  if (mins >= closeStart && mins < afterEnd) {
    return { phase: "AFTER-HOURS", dotColor: "var(--accent-amber)" };
  }
  return { phase: "MARKET CLOSED", dotColor: "var(--text-tertiary)" };
}

type TopBarProps = {
  anySectionExpanded: boolean;
  onToggleAllSections: () => void;
};

export default function TopBar({ anySectionExpanded, onToggleAllSections }: TopBarProps) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const now = new Date();
  void tick;
  const dateLine = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(now);

  const timeLine = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(now);

  const { phase, dotColor } = marketPhaseFor(now);

  return (
    <div
      className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-3 py-2"
      style={{ borderColor: "var(--border-default)", background: "var(--bg-elevated)" }}
    >
      <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-4">
        <div className="min-w-0 shrink-0 leading-tight">
          <span className="font-semibold" style={{ fontSize: "var(--fs-12)", color: "var(--accent-cyan)" }}>
            Stock
          </span>
          <span className="font-semibold" style={{ fontSize: "var(--fs-12)", color: "var(--text-secondary)" }}>
            Stalker
          </span>
          <span className="font-semibold" style={{ fontSize: "var(--fs-12)", color: "var(--accent-cyan)" }}>
            {" "}
            / Pre-Market
          </span>
        </div>
        <div className="pm-mono min-w-0 tabular-nums" style={{ fontSize: "var(--fs-10)", color: "var(--text-secondary)" }}>
          <span>{dateLine}</span>
          <span className="mx-2" style={{ color: "var(--border-strong)" }}>
            ·
          </span>
          <span style={{ color: "var(--text-primary)" }}>{timeLine}</span>
          <span className="ml-1" style={{ color: "var(--text-tertiary)" }}>
            ET
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="pm-pulse-dot shrink-0" style={{ color: dotColor }} aria-hidden />
          <span
            className="font-semibold uppercase tracking-[var(--letter-label)]"
            style={{ fontSize: "var(--fs-9)", color: "var(--text-secondary)" }}
          >
            {phase}
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={onToggleAllSections}
        className="pm-focus shrink-0 rounded border px-2.5 py-1 font-medium uppercase tracking-[var(--letter-label)] transition-colors hover:bg-[color:var(--bg-panel)]"
        style={{
          borderColor: "var(--border-default)",
          color: "var(--text-secondary)",
          fontSize: "var(--fs-9)",
        }}
        aria-label={anySectionExpanded ? "Collapse all pre-market sections" : "Expand all pre-market sections"}
      >
        {anySectionExpanded ? "Collapse all" : "Expand all"}
      </button>
    </div>
  );
}
