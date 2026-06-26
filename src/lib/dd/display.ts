/**
 * Pure display helpers for the DD cards (safe to import client-side — types only).
 * Colors map to StockStalker's existing semantic CSS variables.
 */

import type { DDFlagSeverity, DDSignalLevel } from "./types";

function ordinalSuffix(day: number): string {
  if (day >= 11 && day <= 13) return "th";
  switch (day % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

/** Whole numbers with thousands separators, no decimals (e.g. 1,000,000). */
export function formatIntegerCommas(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("en-US");
}

/** ISO date (YYYY-MM-DD) → "24th June 2026". */
export function formatDisplayDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!m) return iso;
  const year = Number(m[1]);
  const monthIndex = Number(m[2]) - 1;
  const day = Number(m[3]);
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex) || !Number.isFinite(day)) return iso;
  const month = new Date(Date.UTC(year, monthIndex, 1)).toLocaleString("en-GB", {
    month: "long",
    timeZone: "UTC",
  });
  return `${day}${ordinalSuffix(day)} ${month} ${year}`;
}

/** First sentence only — for concise instrument / overhang copy. */
export function firstSentence(text: string | null | undefined, maxLen = 160): string {
  if (!text?.trim()) return "";
  const trimmed = text.trim();
  const match = trimmed.match(/^[\s\S]*?[.!?](?:\s|$)/);
  const sentence = (match ? match[0] : trimmed).trim();
  if (sentence.length <= maxLen) return sentence;
  return `${sentence.slice(0, maxLen - 1).trim()}…`;
}

/** Join note strings and cap at N sentences. */
export function limitSentences(texts: string[], maxSentences: number): string {
  const combined = texts.filter(Boolean).join(" ").trim();
  if (!combined) return "";
  const sentences = combined.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [combined];
  return sentences
    .slice(0, maxSentences)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" ");
}

export function formatUsd(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

export function formatShares(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

export function formatPriceUsd(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
}

export function formatSignedPct(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n}%`;
}

export function formatPct(n: number | null | undefined, dp = 1): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return `${n.toFixed(dp)}%`;
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const diff = Date.now() - ms;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

/** Severity → semantic color var. */
export function severityColor(sev: DDFlagSeverity | null): string {
  if (sev === "red") return "var(--negative)";
  if (sev === "amber") return "var(--accent-amber)";
  if (sev === "green") return "var(--positive)";
  return "var(--text-tertiary)";
}

export function signalLevelColor(level: DDSignalLevel): string {
  if (level === "high") return "var(--negative)";
  if (level === "medium") return "var(--accent-amber)";
  return "var(--positive)";
}

export function verdictColor(verdict: "Bullish" | "Bearish" | "Neutral"): string {
  if (verdict === "Bullish") return "var(--positive)";
  if (verdict === "Bearish") return "var(--negative)";
  return "var(--accent-amber)";
}

export function runwayColor(runwayMonths: number | null, cashFlowPositive: boolean): string {
  if (cashFlowPositive) return "var(--positive)";
  if (runwayMonths == null) return "var(--text-tertiary)";
  if (runwayMonths < 6) return "var(--negative)";
  if (runwayMonths <= 12) return "var(--accent-amber)";
  return "var(--positive)";
}

export function floatLabel(source: string | null): string | null {
  if (source === "manual") return "manual";
  if (source === "polygon_proxy") return "proxy";
  return null;
}
