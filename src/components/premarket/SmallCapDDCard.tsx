"use client";

import type { CSSProperties, ReactNode } from "react";
import {
  floatLabel,
  formatPct,
  formatPriceUsd,
  formatShares,
  formatSignedPct,
  formatUsd,
  relativeTime,
  runwayColor,
  severityColor,
  signalLevelColor,
  verdictColor,
} from "@/lib/dd/display";
import type {
  DDInstrument,
  DDMetrics,
  DDNewsItem,
  DDOverhangBreakdown,
  DDSignalLevel,
  DDVerdictResult,
} from "@/lib/dd/types";

export type DDPhase = "idle" | "loading" | "done" | "error";

export type DDTickerState = {
  ticker: string;
  found: boolean | null;
  metricsPhase: DDPhase;
  metricsError?: string;
  metrics?: DDMetrics;
  provisionalSignals?: { cash_need: DDSignalLevel; float_risk: DDSignalLevel };
  newsPhase: DDPhase;
  news: DDNewsItem[];
  dilutionPhase: DDPhase;
  dilutionError?: string;
  instruments: DDInstrument[];
  overhang: DDOverhangBreakdown | null;
  notes: string[];
  verdict: DDVerdictResult | null;
  floatInput: string;
  marketCapInput: string;
  savingOverride: boolean;
};

type CardProps = {
  state: DDTickerState;
  onChangeFloat: (ticker: string, value: string) => void;
  onChangeMarketCap: (ticker: string, value: string) => void;
  onSaveOverride: (ticker: string) => void;
  onRetry: (ticker: string) => void;
  onRemove: (ticker: string) => void;
};

const CARD_STYLE: CSSProperties = {
  borderColor: "var(--border-default)",
  background: "var(--bg-inset)",
  borderRadius: "var(--radius-md)",
};

function Card({ label, action, children }: { label: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded border px-2.5 py-2" style={CARD_STYLE}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="pm-section-label m-0" style={{ color: "var(--accent-cyan)" }}>
          {label}
        </p>
        {action}
      </div>
      {children}
    </div>
  );
}

function Loading({ text = "Loading…" }: { text?: string }) {
  return (
    <p className="pm-site-caption m-0 animate-pulse" style={{ color: "var(--text-tertiary)" }}>
      {text}
    </p>
  );
}

function Stat({ label, value, sub, color }: { label: string; value: ReactNode; sub?: ReactNode; color?: string }) {
  return (
    <div className="min-w-0">
      <p className="pm-site-caption m-0" style={{ color: "var(--text-tertiary)" }}>
        {label}
      </p>
      <p className="pm-mono m-0 font-semibold tabular-nums" style={{ color: color ?? "var(--text-primary)" }}>
        {value}
      </p>
      {sub ? (
        <p className="pm-site-caption m-0" style={{ color: "var(--text-tertiary)" }}>
          {sub}
        </p>
      ) : null}
    </div>
  );
}

function SignalPill({ label, level }: { label: string; level: DDSignalLevel }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 pm-site-caption font-semibold"
      style={{ background: signalLevelColor(level), color: "#fff" }}
    >
      {label}: {level.toUpperCase()}
    </span>
  );
}

function ManualTag() {
  return (
    <span
      className="ml-1 rounded px-1 py-px pm-site-caption font-semibold align-middle"
      style={{ background: "var(--accent-amber-muted)", color: "var(--accent-amber)" }}
    >
      manual
    </span>
  );
}

// --- News (card 1) ---
function NewsCard({ state }: { state: DDTickerState }) {
  return (
    <Card label="News">
      {state.newsPhase === "loading" ? (
        <Loading text="Loading news…" />
      ) : state.news.length === 0 ? (
        <p className="pm-site-caption m-0" style={{ color: "var(--text-secondary)" }}>
          No company-specific news in the window — gap not explained by fresh news.
        </p>
      ) : (
        <ul className="m-0 list-none space-y-1 p-0">
          {state.news.map((n, i) => (
            <li key={`${n.url}-${i}`} className="min-w-0">
              <a
                href={n.url}
                target="_blank"
                rel="noopener noreferrer"
                className="pm-site-prose font-medium hover:underline"
                style={{ color: "var(--text-primary)" }}
              >
                {n.title}
              </a>
              <span className="pm-site-caption ml-1" style={{ color: "var(--text-tertiary)" }}>
                {n.source} · {relativeTime(n.published_utc)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// --- Verdict banner (card 2) ---
function VerdictBanner({ state }: { state: DDTickerState }) {
  const m = state.metrics;
  const verdict = state.verdict;
  const analyzing = state.dilutionPhase === "loading" || (state.dilutionPhase === "idle" && state.metricsPhase !== "done");
  const cashNeed = verdict?.signals.cash_need ?? state.provisionalSignals?.cash_need;
  const floatRisk = verdict?.signals.float_risk ?? state.provisionalSignals?.float_risk;
  const raisePressure = verdict?.signals.raise_pressure;
  const overhangPct = verdict?.signals.overhang_pct;

  const gapColor =
    m?.gap_pct != null && m.gap_pct > 0
      ? "var(--positive)"
      : m?.gap_pct != null && m.gap_pct < 0
        ? "var(--negative)"
        : "var(--text-secondary)";

  return (
    <div className="rounded border px-2.5 py-2" style={{ ...CARD_STYLE, background: "var(--bg-elevated)" }}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="flex items-baseline gap-2 min-w-0">
          {analyzing && !verdict ? (
            <span className="pm-section-label m-0 animate-pulse" style={{ color: "var(--text-tertiary)" }}>
              Analyzing…
            </span>
          ) : (
            <span
              className="pm-section-label m-0"
              style={{ color: verdict ? verdictColor(verdict.verdict) : "var(--text-tertiary)" }}
            >
              {verdict?.verdict ?? "—"}
            </span>
          )}
          <span className="pm-site-prose min-w-0 truncate" style={{ color: "var(--text-secondary)" }}>
            {verdict?.reason ?? (analyzing ? "reading SEC filings…" : "")}
          </span>
        </div>
        <div className="pm-mono flex items-baseline gap-2 tabular-nums">
          <span style={{ color: "var(--text-primary)" }}>{formatPriceUsd(m?.price)}</span>
          <span style={{ color: gapColor }}>{formatSignedPct(m?.gap_pct)}</span>
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {raisePressure ? <SignalPill label="Raise pressure" level={raisePressure} /> : null}
        {cashNeed ? <SignalPill label="Cash need" level={cashNeed} /> : null}
        {floatRisk ? <SignalPill label="Float risk" level={floatRisk} /> : null}
        {overhangPct != null ? (
          <span
            className="inline-flex items-center rounded px-1.5 py-0.5 pm-site-caption font-semibold"
            style={{
              background:
                overhangPct >= 50 ? "var(--negative)" : overhangPct >= 20 ? "var(--accent-amber)" : "var(--positive)",
              color: "#fff",
            }}
          >
            Overhang: {formatPct(overhangPct)}
            {state.overhang?.open_ended ? "+" : ""}
          </span>
        ) : null}
      </div>
    </div>
  );
}

// --- Key metrics (card 3) ---
function KeyMetricsCard({
  state,
  onChangeFloat,
  onChangeMarketCap,
  onSaveOverride,
}: {
  state: DDTickerState;
  onChangeFloat: (ticker: string, value: string) => void;
  onChangeMarketCap: (ticker: string, value: string) => void;
  onSaveOverride: (ticker: string) => void;
}) {
  const m = state.metrics;
  const editable = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    source: string | null
  ) => (
    <div className="min-w-0">
      <p className="pm-site-caption m-0" style={{ color: "var(--text-tertiary)" }}>
        {label}
        {floatLabel(source) === "manual" ? <ManualTag /> : null}
        {floatLabel(source) === "proxy" ? (
          <span className="ml-1 pm-site-caption" style={{ color: "var(--text-tertiary)" }}>
            (proxy)
          </span>
        ) : null}
      </p>
      <input
        className="pm-focus pm-mono w-full rounded border bg-transparent px-1 py-0.5 tabular-nums"
        style={{ borderColor: "var(--border-default)", color: "var(--text-primary)", fontSize: "var(--ws-fs-body)" }}
        value={value}
        inputMode="numeric"
        placeholder="—"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSaveOverride(state.ticker);
        }}
        onBlur={() => onSaveOverride(state.ticker)}
        disabled={state.savingOverride}
      />
    </div>
  );

  return (
    <Card label="Key metrics">
      {state.metricsPhase === "loading" ? (
        <Loading text="Loading metrics…" />
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {editable("Market cap", state.marketCapInput, (v) => onChangeMarketCap(state.ticker, v), m?.market_cap_source ?? null)}
          {editable("Float", state.floatInput, (v) => onChangeFloat(state.ticker, v), m?.float_source ?? null)}
          <Stat
            label="Short % float"
            value={m?.short_interest_unavailable ? "unavailable" : formatPct(m?.short_pct_float)}
            sub={m?.short_interest_date ? `FINRA ${m.short_interest_date}` : undefined}
          />
          <Stat label="Shares out" value={formatShares(m?.shares_outstanding)} />
        </div>
      )}
    </Card>
  );
}

// --- Cash runway (card 4) ---
function RunwayCard({ state }: { state: DDTickerState }) {
  const m = state.metrics;
  const color = runwayColor(m?.runway_months ?? null, m?.cash_flow_positive ?? false);
  return (
    <Card label="Cash runway">
      {state.metricsPhase === "loading" ? (
        <Loading text="Loading runway…" />
      ) : (
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <p className="pm-mono m-0 text-2xl font-bold leading-none tabular-nums" style={{ color }}>
              {m?.cash_flow_positive ? "Profitable" : m?.runway_months != null ? `${m.runway_months}` : "—"}
            </p>
            <p className="pm-site-caption m-0" style={{ color: "var(--text-tertiary)" }}>
              {m?.cash_flow_positive ? "n/a" : "months left"}
            </p>
          </div>
          <div className="grid flex-1 grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-4">
            <Stat label="Cash on hand" value={formatUsd(m?.cash_on_hand)} />
            <Stat label="TTM op. burn" value={formatUsd(m?.ttm_operating_cf)} />
            <Stat label="Monthly burn" value={formatUsd(m?.monthly_burn)} />
            <Stat label="As of" value={m?.cash_as_of_date ?? "—"} />
          </div>
        </div>
      )}
    </Card>
  );
}

// --- Dilution instruments (card 5, phase 2) ---
function FlagBadge({ inst }: { inst: DDInstrument }) {
  if (!inst.primary_flag) return null;
  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-px pm-site-caption font-semibold"
      style={{ background: "rgba(255,255,255,0.06)", color: severityColor(inst.severity) }}
    >
      {inst.primary_flag}
    </span>
  );
}

function InstrumentsCard({ state, onRetry }: { state: DDTickerState; onRetry: (t: string) => void }) {
  if (state.dilutionPhase === "loading" || state.dilutionPhase === "idle") {
    return (
      <Card label="Dilution instruments">
        <Loading text="Reading SEC filings…" />
      </Card>
    );
  }
  if (state.dilutionPhase === "error") {
    return (
      <Card
        label="Dilution instruments"
        action={
          <button
            type="button"
            onClick={() => onRetry(state.ticker)}
            className="pm-focus rounded border px-2 py-0.5 pm-site-caption font-medium"
            style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
          >
            Retry
          </button>
        }
      >
        <p className="pm-site-caption m-0" style={{ color: "var(--warning)" }}>
          {state.dilutionError ?? "Extraction failed."}
        </p>
      </Card>
    );
  }
  return (
    <Card label="Dilution instruments">
      {state.instruments.length === 0 ? (
        <p className="pm-site-caption m-0" style={{ color: "var(--text-secondary)" }}>
          No active dilution instruments found in recent filings.
        </p>
      ) : (
        <div className="space-y-1.5">
          {state.instruments.map((inst, i) => (
            <div
              key={`${inst.label}-${i}`}
              className="grid grid-cols-[auto_1fr_auto] items-center gap-2 border-b pb-1.5 last:border-b-0"
              style={{ borderColor: "var(--border-default)" }}
            >
              <div className="min-w-0">
                <p className="pm-site-prose m-0 font-semibold" style={{ color: "var(--text-primary)" }}>
                  {inst.label}
                </p>
                <p className="pm-site-caption m-0" style={{ color: "var(--text-tertiary)" }}>
                  {inst.key_terms ?? inst.type} · {inst.source}
                </p>
              </div>
              <div className="pm-mono text-right tabular-nums" style={{ color: "var(--text-secondary)" }}>
                {inst.remaining_usd != null ? formatUsd(inst.remaining_usd) : ""}
                {inst.exercise_or_conversion_price != null ? ` @ ${formatPriceUsd(inst.exercise_or_conversion_price)}` : ""}
                <span className="ml-2" style={{ color: "var(--text-primary)" }}>
                  {inst.open_ended ? "open-ended" : `${formatShares(inst.potential_shares)} sh`}
                </span>
              </div>
              <FlagBadge inst={inst} />
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// --- Remaining overhang (card 6, phase 2) ---
function OverhangCard({ state }: { state: DDTickerState }) {
  if (state.dilutionPhase === "loading" || state.dilutionPhase === "idle") {
    return (
      <Card label="Remaining dilution overhang">
        <Loading text="Computing overhang…" />
      </Card>
    );
  }
  const o = state.overhang;
  if (!o || o.fully_diluted_shares == null || o.current_shares_outstanding == null) {
    return (
      <Card label="Remaining dilution overhang">
        <p className="pm-site-caption m-0" style={{ color: "var(--text-secondary)" }}>
          Overhang not computable (limited data).
        </p>
      </Card>
    );
  }
  const total = o.fully_diluted_shares || 1;
  const currentPct = (o.current_shares_outstanding / total) * 100;
  const headlineColor =
    o.overhang_pct != null && o.overhang_pct >= 50
      ? "var(--negative)"
      : o.overhang_pct != null && o.overhang_pct >= 20
        ? "var(--accent-amber)"
        : "var(--positive)";

  const palette = ["#22d3ee", "#fbbf24", "#c084fc", "#fb923c", "#34d399", "#f87171"];

  return (
    <Card label="Remaining dilution overhang">
      <p className="pm-mono m-0 text-xl font-bold tabular-nums" style={{ color: headlineColor }}>
        {formatPct(o.overhang_pct)}
        {o.open_ended ? "+" : ""}
        <span className="pm-site-caption ml-2 font-normal" style={{ color: "var(--text-tertiary)" }}>
          potential new shares vs current
        </span>
      </p>
      <div
        className="mt-2 flex h-4 w-full overflow-hidden rounded"
        style={{ background: "rgba(255,255,255,0.04)" }}
        title="Current shares + each dilution source = fully diluted"
      >
        <div style={{ width: `${currentPct}%`, background: "var(--text-tertiary)" }} title="Current shares" />
        {o.segments.map((seg, i) => {
          const w = seg.open_ended && seg.shares === 0 ? 2 : (seg.shares / total) * 100;
          return (
            <div
              key={`${seg.label}-${i}`}
              style={{
                width: `${w}%`,
                background: palette[i % palette.length],
                opacity: seg.open_ended ? 0.6 : 1,
              }}
              title={`${seg.label}: ${seg.open_ended ? "open-ended" : formatShares(seg.shares)}`}
            />
          );
        })}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
        <span className="pm-site-caption" style={{ color: "var(--text-tertiary)" }}>
          Current {formatShares(o.current_shares_outstanding)}
        </span>
        <span className="pm-site-caption" style={{ color: "var(--text-tertiary)" }}>
          Fully diluted {formatShares(o.fully_diluted_shares)}
        </span>
      </div>
      {state.notes.length > 0 ? (
        <ul className="m-0 mt-1.5 list-none space-y-0.5 p-0">
          {state.notes.map((note, i) => (
            <li key={i} className="pm-site-caption" style={{ color: "var(--text-tertiary)" }}>
              · {note}
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

// --- Stock splits (card 7) ---
function SplitsCard({ state }: { state: DDTickerState }) {
  const m = state.metrics;
  return (
    <Card label="Stock splits (12mo)">
      {state.metricsPhase === "loading" ? (
        <Loading />
      ) : !m || m.splits.length === 0 ? (
        <p className="pm-site-caption m-0" style={{ color: "var(--text-secondary)" }}>
          No splits in the last 12 months.
        </p>
      ) : (
        <ul className="m-0 list-none space-y-0.5 p-0">
          {m.splits.map((s, i) => (
            <li key={i} className="pm-site-prose flex items-center gap-2">
              <span className="pm-mono" style={{ color: s.is_reverse ? "var(--negative)" : "var(--text-primary)" }}>
                {s.ratio_label}
              </span>
              <span className="pm-site-caption" style={{ color: "var(--text-tertiary)" }}>
                {s.execution_date}
              </span>
              {s.is_reverse ? (
                <span
                  className="rounded px-1 py-px pm-site-caption font-semibold"
                  style={{ background: "rgba(224,90,90,0.14)", color: "var(--negative)" }}
                >
                  reverse
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function SmallCapDDCard({
  state,
  onChangeFloat,
  onChangeMarketCap,
  onSaveOverride,
  onRetry,
  onRemove,
}: CardProps) {
  const warnings = state.metrics?.warnings ?? [];

  return (
    <div className="rounded border" style={{ borderColor: "var(--border-strong)", background: "var(--bg-panel)" }}>
      <div
        className="flex items-center justify-between gap-2 border-b px-2.5 py-1.5"
        style={{ borderColor: "var(--border-default)" }}
      >
        <span className="pm-mono text-lg font-bold" style={{ color: "var(--text-primary)" }}>
          {state.ticker}
          {state.metrics?.name ? (
            <span className="pm-site-caption ml-2 font-normal" style={{ color: "var(--text-tertiary)" }}>
              {state.metrics.name}
            </span>
          ) : null}
        </span>
        <button
          type="button"
          onClick={() => onRemove(state.ticker)}
          className="pm-focus rounded border px-1.5 py-0.5 pm-site-caption"
          style={{ borderColor: "var(--border-default)", color: "var(--text-tertiary)" }}
          aria-label={`Remove ${state.ticker}`}
        >
          ✕
        </button>
      </div>

      <div className="space-y-2 p-2.5">
        {state.found === false ? (
          <p className="pm-site-prose m-0" style={{ color: "var(--warning)" }}>
            Ticker not found.
          </p>
        ) : state.metricsPhase === "error" ? (
          <div className="flex items-center gap-2">
            <p className="pm-site-prose m-0" style={{ color: "var(--warning)" }}>
              {state.metricsError ?? "Failed to load."}
            </p>
            <button
              type="button"
              onClick={() => onRetry(state.ticker)}
              className="pm-focus rounded border px-2 py-0.5 pm-site-caption"
              style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
            >
              Retry
            </button>
          </div>
        ) : (
          <>
            <NewsCard state={state} />
            <VerdictBanner state={state} />
            <KeyMetricsCard
              state={state}
              onChangeFloat={onChangeFloat}
              onChangeMarketCap={onChangeMarketCap}
              onSaveOverride={onSaveOverride}
            />
            <RunwayCard state={state} />
            <InstrumentsCard state={state} onRetry={onRetry} />
            <OverhangCard state={state} />
            <SplitsCard state={state} />
            {warnings.length > 0 ? (
              <ul className="m-0 list-none space-y-0.5 p-0">
                {warnings.map((w, i) => (
                  <li key={i} className="pm-site-caption" style={{ color: "var(--text-tertiary)" }}>
                    ⚠ {w}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
