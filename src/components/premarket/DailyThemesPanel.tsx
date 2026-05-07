"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { industryThemePillClass } from "@/lib/premarket/industry-theme-pill-class";
import type { DailyThemeRow } from "@/types/daily-themes";

type ThemesApi =
  | {
      ok: true;
      ymd: string;
      themes: DailyThemeRow[];
      themesUpdatedAt: string | null;
      setupRequired?: boolean;
      setupMessage?: string;
    }
  | { ok: false; error: string };

const MACRO_CAP = 3;
const INDUSTRY_CAP = 5;
const EXEMPLAR_TICKER_CAP = 4;

function firstTwoSentences(raw: string | null | undefined): string {
  const text = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const matches = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [];
  const trimmed = matches.map((s) => s.trim()).filter(Boolean);
  if (trimmed.length === 0) return text;
  return trimmed.slice(0, 2).join(" ");
}

function uniqueExemplarTickers(raw: string[] | null | undefined, max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of raw ?? []) {
    const u = x.trim().toUpperCase();
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(u);
    if (out.length >= max) break;
  }
  return out;
}

function formatThemesUpdatedAt(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/New_York",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

function CompactThemeRow({ t }: { t: DailyThemeRow }) {
  const tickers = uniqueExemplarTickers(t.exemplar_tickers, EXEMPLAR_TICKER_CAP);
  const industryKey = t.industry?.trim() ?? "";
  const pillClass = industryThemePillClass(industryKey);
  const summary = firstTwoSentences(t.theme_description);
  const showPillRow = tickers.length > 0 || Boolean(industryKey);

  return (
    <li className="border-b py-1.5 last:border-b-0" style={{ borderColor: "var(--border-default)" }}>
      <div className="grid grid-cols-[auto_1fr] items-start gap-x-1.5">
        <span
          className="col-start-1 row-start-1 inline-flex w-3 shrink-0 justify-center leading-none pm-mono"
          style={{ fontSize: "var(--ws-fs-caption)", color: "var(--text-tertiary)" }}
          aria-hidden
        >
          ›
        </span>
        <div className="col-start-2 row-start-1 flex min-w-0 items-baseline gap-1.5">
          <span className="pm-site-prose min-w-0 font-semibold leading-tight" style={{ color: "var(--text-primary)" }}>
            {t.theme_title}
          </span>
          {t.is_new ? (
            <span className="pm-site-caption shrink-0 font-semibold" style={{ color: "var(--positive)" }}>
              NEW
            </span>
          ) : null}
        </div>
        {summary ? (
          <p className="col-start-2 row-start-2 mt-0.5 m-0 pm-site-caption leading-snug" style={{ color: "var(--text-secondary)" }}>
            {summary}
          </p>
        ) : null}
        {showPillRow ? (
          <div className="col-start-2 row-start-3 mt-0.5 flex min-w-0 flex-wrap items-center gap-1">
            {tickers.length > 0
              ? tickers.map((sym) => (
                  <span
                    key={sym}
                    className={`inline-flex shrink-0 items-center rounded-full px-1.5 py-px pm-mono font-semibold tabular-nums ${pillClass}`}
                    style={{ fontSize: "var(--ws-fs-caption)" }}
                    title={industryKey ? `${industryKey} · ${sym}` : sym}
                  >
                    {sym}
                  </span>
                ))
              : industryKey
                ? (
                    <span
                      className={`pm-site-caption inline-flex max-w-full min-w-0 items-center truncate rounded-full px-1.5 py-px font-semibold ${pillClass}`}
                      title={industryKey}
                    >
                      {industryKey}
                    </span>
                  )
                : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

export default function DailyThemesPanel({ refreshToken = 0 }: { refreshToken?: number }) {
  const [themes, setThemes] = useState<DailyThemeRow[] | null>(null);
  const [themesUpdatedAt, setThemesUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [setupHint, setSetupHint] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSetupHint(null);
    setThemesUpdatedAt(null);
    try {
      const res = await fetch("/api/premarket/daily-themes", { cache: "no-store" });
      const json = (await res.json()) as ThemesApi;
      if (!res.ok || !json.ok) {
        setThemes(null);
        setError(!json.ok ? json.error : res.statusText);
        return;
      }
      setThemes(json.themes);
      setThemesUpdatedAt(formatThemesUpdatedAt(json.themesUpdatedAt));
      if (json.setupRequired && json.setupMessage) {
        setSetupHint(json.setupMessage);
      }
    } catch (e) {
      setThemes(null);
      setError(e instanceof Error ? e.message : "Failed to load themes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (refreshToken <= 0) return;
    void load();
  }, [load, refreshToken]);

  const { macroThemes, industryThemes } = useMemo(() => {
    const list = themes ?? [];
    const macro = list.filter((t) => t.theme_type === "macro").slice(0, MACRO_CAP);
    const industry = list.filter((t) => t.theme_type !== "macro").slice(0, INDUSTRY_CAP);
    return { macroThemes: macro, industryThemes: industry };
  }, [themes]);

  if (loading) {
    return (
      <p className="pm-site-prose" style={{ color: "var(--text-secondary)" }}>
        Loading themes…
      </p>
    );
  }

  if (error) {
    return (
      <div className="space-y-2">
        <p className="pm-site-prose" role="alert" style={{ color: "var(--warning)" }}>
          {error}
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="pm-focus rounded border px-2 py-1 font-medium"
          style={{
            borderColor: "var(--border-default)",
            color: "var(--text-secondary)",
            fontFamily: "var(--ws-font-sans)",
            fontSize: "var(--ws-fs-label)",
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!themes?.length) {
    return (
      <div
        className="rounded border px-2 py-2"
        style={{ borderColor: "var(--border-default)", background: "var(--bg-inset)" }}
      >
        {setupHint ? (
          <p className="pm-site-caption mb-1" style={{ color: "var(--accent-amber)" }}>
            {setupHint}
          </p>
        ) : null}
        <p className="pm-site-prose" style={{ color: "var(--text-secondary)" }}>
          No themes yet.
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded border px-2 py-2"
      style={{ borderColor: "var(--border-default)", background: "var(--bg-inset)" }}
    >
      <div className="grid gap-3 lg:grid-cols-2">
        {macroThemes.length ? (
          <div className="min-w-0">
            <p className="pm-section-label mb-0.5" style={{ color: "var(--accent-cyan)" }}>
              MACRO THEMES
            </p>
            <ul className="m-0 list-none p-0">
              {macroThemes.map((t) => (
                <CompactThemeRow key={t.id} t={t} />
              ))}
            </ul>
          </div>
        ) : null}

        {industryThemes.length ? (
          <div className="min-w-0">
            <p className="pm-section-label mb-0.5" style={{ color: "var(--accent-amber)" }}>
              INDUSTRY THEMES
            </p>
            <ul className="m-0 list-none p-0">
              {industryThemes.map((t) => (
                <CompactThemeRow key={t.id} t={t} />
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      {themesUpdatedAt ? (
        <p className="pm-site-caption mb-0 mt-2 pm-mono" style={{ color: "var(--text-tertiary)" }}>
          Updated: {themesUpdatedAt}
        </p>
      ) : null}
    </div>
  );
}
