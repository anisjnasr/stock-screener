"use client";

import { useCallback, useEffect, useState } from "react";
import { ymdInEt } from "@/lib/et-ymd";
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

function ThemeCard({ t }: { t: DailyThemeRow }) {
  const tickers = t.exemplar_tickers?.filter(Boolean) ?? [];
  const signals = t.trigger_signals?.filter(Boolean) ?? [];
  return (
    <div
      className="rounded border px-2.5 py-2 text-[11.5px] leading-snug sm:text-xs"
      style={{ borderColor: "var(--ws-border)", color: "var(--ws-text)" }}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
          style={{
            background: t.theme_type === "macro" ? "rgba(6, 182, 212, 0.12)" : "rgba(168, 85, 247, 0.12)",
            color: t.theme_type === "macro" ? "#22d3ee" : "#c084fc",
          }}
        >
          {t.theme_type} #{t.theme_rank}
        </span>
        {t.is_new ? (
          <span className="text-[10px] font-medium uppercase tracking-wide" style={{ color: "#34d399" }}>
            New
          </span>
        ) : null}
        {t.industry ? (
          <span className="text-[10px]" style={{ color: "var(--ws-text-dim)" }}>
            {t.industry}
          </span>
        ) : null}
      </div>
      <h4 className="mt-1.5 font-semibold leading-snug">{t.theme_title}</h4>
      <p className="mt-1 whitespace-pre-wrap" style={{ color: "var(--ws-text-dim)" }}>
        {t.theme_description}
      </p>
      {t.asset_implications ? (
        <p className="mt-1.5">
          <span className="font-medium" style={{ color: "var(--ws-text)" }}>
            Assets:{" "}
          </span>
          <span style={{ color: "var(--ws-text-dim)" }}>{t.asset_implications}</span>
        </p>
      ) : null}
      {t.key_watch ? (
        <p className="mt-1">
          <span className="font-medium" style={{ color: "var(--ws-text)" }}>
            Watch:{" "}
          </span>
          <span style={{ color: "var(--ws-text-dim)" }}>{t.key_watch}</span>
        </p>
      ) : null}
      {tickers.length ? (
        <p className="mt-1 tabular-nums" style={{ color: "var(--ws-text-vdim)" }}>
          Tickers: {tickers.join(", ")}
        </p>
      ) : null}
      {signals.length ? (
        <p className="mt-1" style={{ color: "var(--ws-text-vdim)" }}>
          Triggers: {signals.join(" · ")}
        </p>
      ) : null}
    </div>
  );
}

export default function DailyThemesPanel() {
  const [themes, setThemes] = useState<DailyThemeRow[] | null>(null);
  const [ymd, setYmd] = useState<string | null>(null);
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
        setYmd(null);
        setError(!json.ok ? json.error : res.statusText);
        return;
      }
      setYmd(json.ymd);
      setThemes(json.themes);
      if (json.setupRequired && json.setupMessage) {
        setSetupHint(json.setupMessage);
      }
    } catch (e) {
      setThemes(null);
      setYmd(null);
      setError(e instanceof Error ? e.message : "Failed to load themes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <p className="text-sm leading-relaxed" style={{ color: "var(--ws-text-dim)" }}>
        Loading daily themes…
      </p>
    );
  }

  if (error) {
    return (
      <div className="space-y-2">
        <p className="text-sm leading-relaxed" role="alert" style={{ color: "#f59e0b" }}>
          {error}
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded border px-2 py-1 text-xs font-medium uppercase tracking-wide transition-colors ws-focus-ring hover:bg-[color:var(--ws-hover)]"
          style={{ borderColor: "var(--ws-border)", color: "var(--ws-text)" }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!themes?.length) {
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
        <p className="text-sm leading-relaxed" style={{ color: "var(--ws-text-dim)" }}>
          No themes for {ymd ?? ymdInEt()} yet. Run theme extraction after macro and equities writeups.
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded border px-2 py-1 text-[11px] font-medium uppercase tracking-wide transition-colors ws-focus-ring hover:bg-[color:var(--ws-hover)]"
          style={{ borderColor: "var(--ws-border)", color: "var(--ws-text-dim)" }}
        >
          Refresh
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        {themes.map((t) => (
          <ThemeCard key={t.id} t={t} />
        ))}
      </div>
      <button
        type="button"
        onClick={() => void load()}
        className="rounded border px-2 py-1 text-[11px] font-medium uppercase tracking-wide transition-colors ws-focus-ring hover:bg-[color:var(--ws-hover)]"
        style={{ borderColor: "var(--ws-border)", color: "var(--ws-text-dim)" }}
      >
        Refresh
      </button>
    </div>
  );
}
