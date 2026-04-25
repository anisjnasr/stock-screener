"use client";

import { useState, type CSSProperties } from "react";
import {
  GAPPER_CAP_PRESET_MC,
  type GapperCapPreset,
  type GapperFilterState,
} from "@/components/premarket/gapper-filters-storage";
import {
  abbreviateUsdFilterDisplay,
  formatUsdIntInputDisplay,
  parseFlexibleFilterNumber,
} from "@/components/premarket/premarket-number-display";
import type { GappersRequestBody } from "@/types/gappers";

type GapperFilterControlsProps = {
  filters: GapperFilterState;
  onFiltersChange: (next: GapperFilterState) => void;
  onPrimaryAction: (next: GapperFilterState) => void;
  primaryLabel: string;
  loading?: boolean;
  onSecondaryRefresh?: () => void;
  secondaryLabel?: string;
  lastRefreshSeconds?: number | null;
};

function parseDecimalBlur(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const x = Number(t);
  return Number.isFinite(x) ? x : null;
}

const gapFilterLabelStyle: CSSProperties = {
  fontFamily: "var(--ws-font-sans)",
  fontSize: "var(--ws-fs-caption)",
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "#8a8a8a",
  whiteSpace: "nowrap",
};

const gapFilterInputStyle: CSSProperties = {
  height: 30,
  padding: "5px 9px",
  fontFamily: "var(--ws-font-mono)",
  fontSize: "var(--ws-fs-body)",
  background: "#1c1c1c",
  border: "1px solid #333",
  borderRadius: 3,
  color: "#e5e5e5",
  boxSizing: "border-box",
};

export default function GapperFilterControls({
  filters,
  onFiltersChange,
  onPrimaryAction,
  primaryLabel,
  loading = false,
  onSecondaryRefresh,
  secondaryLabel = "Refresh scan",
  lastRefreshSeconds = null,
}: GapperFilterControlsProps) {
  const [mcapMinDraft, setMcapMinDraft] = useState<string | null>(null);
  const [mcapMaxDraft, setMcapMaxDraft] = useState<string | null>(null);
  const [minAvgVolDraft, setMinAvgVolDraft] = useState<string | null>(null);
  const [minPriceDraft, setMinPriceDraft] = useState<string | null>(null);
  const [minGapDraft, setMinGapDraft] = useState<string | null>(null);
  const [minPmVolDraft, setMinPmVolDraft] = useState<string | null>(null);
  const [minVolPctDraft, setMinVolPctDraft] = useState<string | null>(null);

  const clearDrafts = () => {
    setMcapMinDraft(null);
    setMcapMaxDraft(null);
    setMinAvgVolDraft(null);
    setMinPriceDraft(null);
    setMinGapDraft(null);
    setMinPmVolDraft(null);
    setMinVolPctDraft(null);
  };

  const setCustomField = <K extends keyof GappersRequestBody>(key: K, value: number) => {
    onFiltersChange({ ...filters, [key]: value, capPreset: "custom" });
  };

  const filtersWithDraftValues = (): GapperFilterState => {
    let next = { ...filters };

    const minMcap = mcapMinDraft != null ? parseFlexibleFilterNumber(mcapMinDraft) : null;
    if (minMcap != null) {
      next = {
        ...next,
        minMarketCap: Math.min(minMcap, next.maxMarketCap ?? 10_000_000_000_000),
        capPreset: "custom",
      };
    }

    const maxMcap = mcapMaxDraft != null ? parseFlexibleFilterNumber(mcapMaxDraft) : null;
    if (maxMcap != null) {
      next = {
        ...next,
        maxMarketCap: Math.max(maxMcap, next.minMarketCap ?? 0),
        capPreset: "custom",
      };
    }

    const minPrice = minPriceDraft != null ? parseDecimalBlur(minPriceDraft) : null;
    if (minPrice != null) next = { ...next, minPrice: Math.max(0.01, minPrice), capPreset: "custom" };

    const minGapPct = minGapDraft != null ? parseDecimalBlur(minGapDraft) : null;
    if (minGapPct != null) next = { ...next, minGapPct: Math.max(0, minGapPct), capPreset: "custom" };

    const minPmVolume = minPmVolDraft != null ? parseDecimalBlur(minPmVolDraft) : null;
    if (minPmVolume != null) next = { ...next, minPmVolume: Math.max(0, Math.round(minPmVolume)), capPreset: "custom" };

    const minAvgVolume = minAvgVolDraft != null ? parseFlexibleFilterNumber(minAvgVolDraft) : null;
    if (minAvgVolume != null) next = { ...next, minAvgVolume: Math.max(0, Math.round(minAvgVolume)), capPreset: "custom" };

    const minVolPct = minVolPctDraft != null ? parseDecimalBlur(minVolPctDraft) : null;
    if (minVolPct != null) next = { ...next, minVolPct: Math.max(0, minVolPct), capPreset: "custom" };

    return next;
  };

  const handlePrimaryAction = () => {
    const next = filtersWithDraftValues();
    clearDrafts();
    onFiltersChange(next);
    onPrimaryAction(next);
  };

  const applyPreset = (preset: Exclude<GapperCapPreset, "custom">) => {
    clearDrafts();
    const { min, max } = GAPPER_CAP_PRESET_MC[preset];
    onFiltersChange({ ...filters, capPreset: preset, minMarketCap: min, maxMarketCap: max });
  };

  return (
    <div className="flex flex-wrap items-center gap-[14px] px-[14px] py-[10px]" style={{ alignItems: "center" }}>
      <div className="flex items-center gap-1.5">
        <span style={gapFilterLabelStyle}>Preset</span>
        <select
          value={filters.capPreset === "custom" ? "custom" : filters.capPreset}
          onChange={(e) => {
            const value = e.target.value;
            if (value === "custom") {
              onFiltersChange({ ...filters, capPreset: "custom" });
              return;
            }
            applyPreset(value as Exclude<GapperCapPreset, "custom">);
          }}
          className="tabular-nums outline-none ws-focus-ring focus:border-[#3BBFCF]"
          style={{ ...gapFilterInputStyle, width: 110 }}
        >
          <option value="all">All (no min)</option>
          <option value="mid">Mid ($2B-$10B)</option>
          <option value="large">Large ($10B-$200B)</option>
          <option value="mega">Mega ($200B+)</option>
          <option value="custom">Custom</option>
        </select>
      </div>

      <div className="h-5 w-px shrink-0 bg-[#333]" aria-hidden />

      <div className="flex items-center gap-1.5">
        <span style={gapFilterLabelStyle}>MCap</span>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          className="text-right outline-none ws-focus-ring focus:border-[#3BBFCF]"
          style={{ ...gapFilterInputStyle, width: 60 }}
          value={mcapMinDraft ?? abbreviateUsdFilterDisplay(filters.minMarketCap ?? 0)}
          onFocus={() => setMcapMinDraft(formatUsdIntInputDisplay(filters.minMarketCap))}
          onChange={(e) => setMcapMinDraft(e.target.value)}
          onBlur={(e) => {
            setMcapMinDraft(null);
            const value = parseFlexibleFilterNumber(e.currentTarget.value);
            if (value == null) return;
            onFiltersChange({
              ...filters,
              minMarketCap: Math.min(value, filters.maxMarketCap ?? 10_000_000_000_000),
              capPreset: "custom",
            });
          }}
        />
        <span className="pm-mono" style={{ color: "#8a8a8a", fontSize: "var(--ws-fs-body)" }}>
          -
        </span>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          className="text-right outline-none ws-focus-ring focus:border-[#3BBFCF]"
          style={{ ...gapFilterInputStyle, width: 60 }}
          value={mcapMaxDraft ?? abbreviateUsdFilterDisplay(filters.maxMarketCap ?? 0)}
          onFocus={() => setMcapMaxDraft(formatUsdIntInputDisplay(filters.maxMarketCap))}
          onChange={(e) => setMcapMaxDraft(e.target.value)}
          onBlur={(e) => {
            setMcapMaxDraft(null);
            const value = parseFlexibleFilterNumber(e.currentTarget.value);
            if (value == null) return;
            onFiltersChange({
              ...filters,
              maxMarketCap: Math.max(value, filters.minMarketCap ?? 0),
              capPreset: "custom",
            });
          }}
        />
      </div>

      <div className="flex items-center gap-1.5">
        <span style={gapFilterLabelStyle}>Price ≥</span>
        <input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          className="text-right outline-none ws-focus-ring focus:border-[#3BBFCF]"
          style={{ ...gapFilterInputStyle, width: 50 }}
          value={minPriceDraft === null ? String(filters.minPrice) : minPriceDraft}
          onFocus={() => setMinPriceDraft(String(filters.minPrice))}
          onChange={(e) => setMinPriceDraft(e.target.value)}
          onBlur={(e) => {
            setMinPriceDraft(null);
            const value = parseDecimalBlur(e.currentTarget.value);
            if (value != null) setCustomField("minPrice", Math.max(0.01, value));
          }}
        />
      </div>

      <div className="flex items-center gap-1.5">
        <span style={gapFilterLabelStyle}>Gap % ≥</span>
        <input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          className="text-right outline-none ws-focus-ring focus:border-[#3BBFCF]"
          style={{ ...gapFilterInputStyle, width: 50 }}
          value={minGapDraft === null ? String(filters.minGapPct) : minGapDraft}
          onFocus={() => setMinGapDraft(String(filters.minGapPct))}
          onChange={(e) => setMinGapDraft(e.target.value)}
          onBlur={(e) => {
            setMinGapDraft(null);
            const value = parseDecimalBlur(e.currentTarget.value);
            if (value != null) setCustomField("minGapPct", Math.max(0, value));
          }}
        />
      </div>

      <div className="flex items-center gap-1.5">
        <span style={gapFilterLabelStyle}>PM Vol ≥</span>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          className="text-right outline-none ws-focus-ring focus:border-[#3BBFCF]"
          style={{ ...gapFilterInputStyle, width: 60 }}
          value={minPmVolDraft === null ? String(filters.minPmVolume) : minPmVolDraft}
          onFocus={() => setMinPmVolDraft(String(filters.minPmVolume))}
          onChange={(e) => setMinPmVolDraft(e.target.value)}
          onBlur={(e) => {
            setMinPmVolDraft(null);
            const value = parseDecimalBlur(e.currentTarget.value);
            if (value != null) setCustomField("minPmVolume", Math.max(0, Math.round(value)));
          }}
        />
      </div>

      <div className="flex items-center gap-1.5">
        <span style={gapFilterLabelStyle}>Avg Vol ≥</span>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          className="text-right outline-none ws-focus-ring focus:border-[#3BBFCF]"
          style={{ ...gapFilterInputStyle, width: 60 }}
          value={minAvgVolDraft ?? abbreviateUsdFilterDisplay(filters.minAvgVolume ?? 0)}
          onFocus={() => setMinAvgVolDraft(formatUsdIntInputDisplay(filters.minAvgVolume))}
          onChange={(e) => setMinAvgVolDraft(e.target.value)}
          onBlur={(e) => {
            setMinAvgVolDraft(null);
            const value = parseFlexibleFilterNumber(e.currentTarget.value);
            if (value != null) setCustomField("minAvgVolume", Math.max(0, Math.round(value)));
          }}
        />
      </div>

      <div className="flex items-center gap-1.5">
        <span style={gapFilterLabelStyle}>Vol % ≥</span>
        <input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          className="text-right outline-none ws-focus-ring focus:border-[#3BBFCF]"
          style={{ ...gapFilterInputStyle, width: 50 }}
          value={minVolPctDraft === null ? String(filters.minVolPct ?? 0) : minVolPctDraft}
          onFocus={() => setMinVolPctDraft(String(filters.minVolPct ?? 0))}
          onChange={(e) => setMinVolPctDraft(e.target.value)}
          onBlur={(e) => {
            setMinVolPctDraft(null);
            const value = parseDecimalBlur(e.currentTarget.value);
            if (value != null) setCustomField("minVolPct", Math.max(0, value));
          }}
        />
      </div>

      <div className="min-w-2 flex-1" aria-hidden />

      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={handlePrimaryAction}
        disabled={loading}
        className="shrink-0 rounded font-medium transition-colors ws-focus-ring hover:opacity-90 disabled:opacity-50"
        style={{
          height: 30,
          padding: "4px 12px",
          fontFamily: "var(--ws-font-sans)",
          fontSize: "var(--ws-fs-label)",
          border: "1px solid var(--ws-cyan)",
          color: "var(--ws-cyan)",
          background: "rgba(59, 191, 207, 0.08)",
        }}
      >
        {primaryLabel}
      </button>

      {onSecondaryRefresh ? (
        <button
          type="button"
          onClick={() => {
            clearDrafts();
            onSecondaryRefresh();
          }}
          disabled={loading}
          className="shrink-0 rounded font-medium transition-colors ws-focus-ring hover:bg-[color:var(--ws-hover)] disabled:opacity-50"
          style={{
            height: 30,
            padding: "4px 12px",
            fontFamily: "var(--ws-font-sans)",
            fontSize: "var(--ws-fs-title)",
            lineHeight: 1,
            border: "1px solid var(--ws-border)",
            color: "var(--ws-text-dim)",
            background: "var(--ws-bg)",
          }}
          title={secondaryLabel}
          aria-label={secondaryLabel}
        >
          ↻
        </button>
      ) : null}

      {lastRefreshSeconds != null ? (
        <span
          className="shrink-0 tabular-nums"
          style={{
            fontFamily: "var(--ws-font-mono)",
            fontSize: "var(--ws-fs-caption)",
            color: "#8a8a8a",
          }}
          title="Duration of the last TradingView request"
        >
          {lastRefreshSeconds.toFixed(2)}s
        </span>
      ) : null}
    </div>
  );
}
