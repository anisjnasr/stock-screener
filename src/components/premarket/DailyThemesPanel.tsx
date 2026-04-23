"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { industryThemePillClass } from "@/lib/premarket/industry-theme-pill-class";
import type { DailyThemeRow } from "@/types/daily-themes";

type ThemesApi =
  | {
      ok: true;
      ymd: string;
      themes: DailyThemeRow[];
      setupRequired?: boolean;
      setupMessage?: string;
    }
  | { ok: false; error: string };

const MACRO_CAP = 3;
const INDUSTRY_CAP = 5;
const EXEMPLAR_TICKER_CAP = 4;

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

function CompactThemeRow({ t }: { t: DailyThemeRow }) {
  const tickers = uniqueExemplarTickers(t.exemplar_tickers, EXEMPLAR_TICKER_CAP);
  const industryKey = t.industry?.trim() ?? "";
  const pillClass = industryThemePillClass(industryKey);
  const showPillRow = tickers.length > 0 || Boolean(industryKey);

  return (
    <li className="border-b py-1.5 last:border-b-0" style={{ borderColor: "var(--border-default)" }}>
      <div className="grid grid-cols-[auto_1fr] items-baseline gap-x-1.5">
        <span
          className="col-start-1 row-start-1 pm-mono tabular-nums"
          style={{ fontSize: "var(--fs-9)", color: "var(--text-tertiary)" }}
        >
          #{t.theme_rank}
        </span>
        <div className="col-start-2 row-start-1 flex min-w-0 items-baseline gap-1.5">
          <span className="min-w-0 flex-1 font-semibold leading-tight" style={{ fontSize: "var(--fs-10)", color: "var(--text-primary)" }}>
            {t.theme_title}
          </span>
          {t.is_new ? (
            <span className="shrink-0" style={{ fontSize: "var(--fs-8)", color: "var(--positive)", fontWeight: 600 }}>
              NEW
            </span>
          ) : null}
        </div>
        {showPillRow ? (
          <div className="col-start-2 row-start-2 mt-0.5 flex min-w-0 flex-wrap items-center gap-1">
            {tickers.length > 0
              ? tickers.map((sym) => (
                  <span
                    key={sym}
                    className={`inline-flex shrink-0 items-center rounded-full px-1.5 py-px pm-mono font-semibold tabular-nums ${pillClass}`}
                    style={{ fontSize: "var(--fs-8)" }}
                    title={industryKey ? `${industryKey} · ${sym}` : sym}
                  >
                    {sym}
                  </span>
                ))
              : industryKey
                ? (
                    <span
                      className={`inline-flex max-w-full min-w-0 items-center truncate rounded-full px-1.5 py-px font-semibold ${pillClass}`}
                      style={{ fontSize: "var(--fs-8)" }}
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

export default function DailyThemesPanel() {
  const [themes, setThemes] = useState<DailyThemeRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [setupHint, setSetupHint] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSetupHint(null);
    try {
      const res = await fetch("/api/premarket/daily-themes", { cache: "no-store" });
      const json = (await res.json()) as ThemesApi;
      if (!res.ok || !json.ok) {
        setThemes(null);
        setError(!json.ok ? json.error : res.statusText);
        return;
      }
      setThemes(json.themes);
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

  const { macroThemes, industryThemes } = useMemo(() => {
    const list = themes ?? [];
    const macro = list.filter((t) => t.theme_type === "macro").slice(0, MACRO_CAP);
    const industry = list.filter((t) => t.theme_type !== "macro").slice(0, INDUSTRY_CAP);
    return { macroThemes: macro, industryThemes: industry };
  }, [themes]);

  if (loading) {
    return (
      <p style={{ color: "var(--text-secondary)", fontSize: "var(--fs-10)" }}>
        Loading themes…
      </p>
    );
  }

  if (error) {
    return (
      <div className="space-y-2">
        <p role="alert" style={{ color: "var(--warning)", fontSize: "var(--fs-10)" }}>
          {error}
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="pm-focus rounded border px-2 py-1 font-medium uppercase tracking-[var(--letter-label)]"
          style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)", fontSize: "var(--fs-9)" }}
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
        <div className="mb-1">
          <span className="font-semibold uppercase tracking-[var(--letter-label)]" style={{ fontSize: "var(--fs-9)", color: "var(--accent-cyan)" }}>
            Active themes
          </span>
        </div>
        {setupHint ? (
          <p className="mb-1" style={{ color: "var(--accent-amber)", fontSize: "var(--fs-9)" }}>
            {setupHint}
          </p>
        ) : null}
        <p style={{ color: "var(--text-secondary)", fontSize: "var(--fs-10)" }}>
          No themes yet. Run extraction after macro + equities writeups.
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="pm-focus mt-2 rounded border px-2 py-1 font-medium uppercase tracking-[var(--letter-label)]"
          style={{ borderColor: "var(--border-default)", color: "var(--text-tertiary)", fontSize: "var(--fs-8)" }}
        >
          Refresh
        </button>
      </div>
    );
  }

  return (
    <div
      className="rounded border px-2 py-2"
      style={{ borderColor: "var(--border-default)", background: "var(--bg-inset)" }}
    >
      <div className="mb-2 border-b pb-1.5" style={{ borderColor: "var(--border-default)" }}>
        <span className="font-semibold uppercase tracking-[var(--letter-label)]" style={{ fontSize: "var(--fs-9)", color: "var(--accent-cyan)" }}>
          Active themes
        </span>
      </div>

      {macroThemes.length ? (
        <div className="mb-2">
          <p className="mb-0.5 font-semibold uppercase tracking-[var(--letter-label)]" style={{ fontSize: "var(--fs-8)", color: "var(--text-tertiary)" }}>
            Macro
          </p>
          <ul className="m-0 list-none p-0">
            {macroThemes.map((t) => (
              <CompactThemeRow key={t.id} t={t} />
            ))}
          </ul>
        </div>
      ) : null}

      {industryThemes.length ? (
        <div>
          <p className="mb-0.5 font-semibold uppercase tracking-[var(--letter-label)]" style={{ fontSize: "var(--fs-8)", color: "var(--text-tertiary)" }}>
            Industry
          </p>
          <ul className="m-0 list-none p-0">
            {industryThemes.map((t) => (
              <CompactThemeRow key={t.id} t={t} />
            ))}
          </ul>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => void load()}
        className="pm-focus mt-2 w-full rounded border py-1 font-medium uppercase tracking-[var(--letter-label)]"
        style={{ borderColor: "var(--border-default)", color: "var(--text-tertiary)", fontSize: "var(--fs-8)" }}
      >
        Refresh
      </button>
    </div>
  );
}
