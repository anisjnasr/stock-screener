"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import CollapsibleSection from "./CollapsibleSection";
import EarningsCalendar from "./EarningsCalendar";
import DailyThemesPanel from "./DailyThemesPanel";
import LargeCapAnalysisPanel from "./LargeCapAnalysisPanel";
import { usePremarketLayout } from "./usePremarketLayout";
import type { PremarketSectionId } from "./premarket-layout-storage";

const SECTION_ORDER: PremarketSectionId[] = ["context", "largeCap", "earnings"];

type SectionConfig = {
  id: PremarketSectionId;
  label: string;
  labelAccent?: "cyan" | "amber" | "default";
  stub: string;
};

const SECTIONS: SectionConfig[] = [
  { id: "context", label: "THEMES", labelAccent: "cyan", stub: "" },
  { id: "largeCap", label: "Large Cap Analysis", labelAccent: "cyan", stub: "" },
  { id: "earnings", label: "Earnings", labelAccent: "cyan", stub: "" },
];

type PreMarketPageProps = {
  onOpenTickerInLists?: (sym: string) => void;
};

type ManualPremarketRefreshResponse = {
  ok: boolean;
  elapsedMs?: number;
  newsletter?: {
    inserted?: number;
    examined?: number;
  };
  themes?: {
    themeCount?: number;
  };
  error?: string;
};

function formatElapsedLabel(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export default function PreMarketPage({ onOpenTickerInLists }: PreMarketPageProps) {
  const { collapsed, toggle, collapseAll, expandAll } = usePremarketLayout();

  const [themesRefreshToken, setThemesRefreshToken] = useState(0);
  const [themesRefreshBusy, setThemesRefreshBusy] = useState(false);
  const [themesRefreshElapsedMs, setThemesRefreshElapsedMs] = useState(0);
  const [themesRefreshStartedAtMs, setThemesRefreshStartedAtMs] = useState<number | null>(null);
  const [themesRefreshError, setThemesRefreshError] = useState<string | null>(null);

  const anySectionExpanded = useMemo(() => SECTION_ORDER.some((id) => !collapsed[id]), [collapsed]);

  useEffect(() => {
    if (!themesRefreshBusy || themesRefreshStartedAtMs == null) return;
    const id = window.setInterval(() => {
      setThemesRefreshElapsedMs(Date.now() - themesRefreshStartedAtMs);
    }, 250);
    return () => window.clearInterval(id);
  }, [themesRefreshBusy, themesRefreshStartedAtMs]);

  const runManualPremarketRefresh = useCallback(async (): Promise<ManualPremarketRefreshResponse> => {
    const res = await fetch("/api/admin/premarket-refresh", {
      method: "POST",
      cache: "no-store",
    });
    // Use res.text() + JSON.parse so a non-JSON body (HTML timeout/error page, gateway
    // error) always yields a clean error string instead of leaking a raw SyntaxError.
    // Also avoids the HTTP/2 empty-statusText trap where res.statusText is "".
    let json: ManualPremarketRefreshResponse;
    try {
      json = JSON.parse(await res.text()) as ManualPremarketRefreshResponse;
    } catch {
      return { ok: false, error: `Server error (HTTP ${res.status})` };
    }
    if (!res.ok) return { ok: false, error: json.error || `Server error (HTTP ${res.status})` };
    return json;
  }, []);

  const triggerThemesRefresh = useCallback(async () => {
    if (themesRefreshBusy) return;
    const startedAtMs = Date.now();
    setThemesRefreshStartedAtMs(startedAtMs);
    setThemesRefreshElapsedMs(0);
    setThemesRefreshError(null);
    setThemesRefreshBusy(true);
    try {
      const result = await runManualPremarketRefresh();

      if (!result.ok) {
        setThemesRefreshError(result.error || "Refresh failed");
        // Still bump the token so the panel refetches whatever is currently in the DB.
        setThemesRefreshToken((v) => v + 1);
        return;
      }

      const elapsedMs = result.elapsedMs ?? Date.now() - startedAtMs;
      setThemesRefreshElapsedMs(elapsedMs);
      setThemesRefreshToken((v) => v + 1);
    } catch (e) {
      setThemesRefreshError(e instanceof Error ? e.message : "Refresh failed");
      setThemesRefreshToken((v) => v + 1);
    } finally {
      setThemesRefreshBusy(false);
      setThemesRefreshStartedAtMs(null);
    }
  }, [runManualPremarketRefresh, themesRefreshBusy]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" style={{ background: "var(--bg-base)" }}>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {SECTIONS.map((s) => (
          <CollapsibleSection
            key={s.id}
            id={s.id}
            label={s.label}
            labelAccent={s.labelAccent}
            collapsed={collapsed[s.id]}
            onToggle={() => toggle(s.id)}
            actions={
              s.id === "context" ? (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => void triggerThemesRefresh()}
                    disabled={themesRefreshBusy}
                    className="pm-focus shrink-0 cursor-pointer rounded border px-2.5 py-1 font-medium transition-colors hover:bg-[color:var(--bg-elevated)] disabled:cursor-not-allowed disabled:opacity-70"
                    style={{
                      borderColor: "var(--border-default)",
                      color: "var(--text-secondary)",
                      fontFamily: "var(--ws-font-sans)",
                      fontSize: "var(--ws-fs-label)",
                    }}
                    aria-label="Run newsletter ingest and refresh themes"
                  >
                    {themesRefreshBusy ? "Running..." : "Refresh"}
                  </button>
                  <span className="pm-site-caption pm-mono tabular-nums" style={{ color: "var(--text-tertiary)" }}>
                    {formatElapsedLabel(themesRefreshElapsedMs)}
                  </span>
                  {themesRefreshError ? (
                    <span
                      className="pm-site-caption max-w-[18rem] truncate"
                      style={{ color: "var(--warning)" }}
                      title={themesRefreshError}
                    >
                      {themesRefreshError}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => (anySectionExpanded ? collapseAll() : expandAll())}
                    className="pm-focus shrink-0 cursor-pointer rounded border px-2.5 py-1 font-medium transition-colors hover:bg-[color:var(--bg-elevated)]"
                    style={{
                      borderColor: "var(--border-default)",
                      color: "var(--text-secondary)",
                      fontFamily: "var(--ws-font-sans)",
                      fontSize: "var(--ws-fs-label)",
                    }}
                    aria-label={anySectionExpanded ? "Collapse all pre-market sections" : "Expand all pre-market sections"}
                  >
                    {anySectionExpanded ? "Collapse all" : "Expand all"}
                  </button>
                </div>
              ) : undefined
            }
          >
            {s.id === "earnings" ? (
              <EarningsCalendar onOpenTickerInLists={onOpenTickerInLists} />
            ) : s.id === "context" ? (
              <DailyThemesPanel refreshToken={themesRefreshToken} />
            ) : s.id === "largeCap" ? (
              <LargeCapAnalysisPanel />
            ) : (
              <p className="max-w-prose leading-relaxed">{s.stub}</p>
            )}
          </CollapsibleSection>
        ))}
      </div>
    </div>
  );
}
