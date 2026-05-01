"use client";

import { forwardRef, useCallback, useImperativeHandle, useState, type CSSProperties } from "react";
import {
  GAPPER_CAP_PRESET_MC,
  type GapperCapPreset,
  type GapperFilterState,
  type SavedGapperFilterPreset,
} from "@/components/premarket/gapper-filters-storage";
import {
  abbreviateUsdFilterDisplay,
  formatUsdIntInputDisplay,
  parseFlexibleFilterNumber,
} from "@/components/premarket/premarket-number-display";
import type { GappersRequestBody } from "@/types/gappers";

export type GapperFilterControlsRef = {
  /** Merge input drafts into filter state and invoke `onPrimaryAction` (same as the primary button). */
  applyFiltersAndRunPrimary: () => void;
};

type GapperFilterControlsProps = {
  filters: GapperFilterState;
  onFiltersChange: (next: GapperFilterState) => void;
  onPrimaryAction: (next: GapperFilterState) => void;
  savedPresets?: SavedGapperFilterPreset[];
  selectedSavedPresetId?: string | null;
  onSelectSavedPresetId?: (presetId: string | null) => void;
  onApplySavedPreset?: (presetId: string) => void;
  onSaveCurrentPreset?: (name: string, next: GapperFilterState) => void;
  onRenameSavedPreset?: (presetId: string, nextName: string) => void;
  onDeleteSavedPreset?: (presetId: string) => void;
  primaryLabel: string;
  loading?: boolean;
  /** Hide the teal primary button (e.g. SIP moves refresh to header). Caller should use ref `applyFiltersAndRunPrimary`. */
  hidePrimaryButton?: boolean;
  onSecondaryRefresh?: () => void;
  secondaryLabel?: string;
  lastRefreshSeconds?: number | null;
};

type NumericGapperRequestKey = Exclude<keyof GappersRequestBody, "includeNews">;

function parseDecimalBlur(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const x = Number(t);
  return Number.isFinite(x) ? x : null;
}

/** Readable price for filter inputs (USD per share). */
function formatPriceFilterDisplay(n: number): string {
  if (!Number.isFinite(n)) return "";
  if (n >= 1_000_000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  const s = n.toFixed(4).replace(/\.?0+$/, "");
  return s;
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

const GapperFilterControls = forwardRef<GapperFilterControlsRef, GapperFilterControlsProps>(function GapperFilterControls(
  {
    filters,
    onFiltersChange,
    onPrimaryAction,
    savedPresets,
    selectedSavedPresetId = null,
    onSelectSavedPresetId,
    onApplySavedPreset,
    onSaveCurrentPreset,
    onRenameSavedPreset,
    onDeleteSavedPreset,
    primaryLabel,
    loading = false,
    hidePrimaryButton = false,
    onSecondaryRefresh,
    secondaryLabel = "Refresh scan",
    lastRefreshSeconds = null,
  },
  ref
) {
  const [mcapMinDraft, setMcapMinDraft] = useState<string | null>(null);
  const [mcapMaxDraft, setMcapMaxDraft] = useState<string | null>(null);
  const [minPriceDraft, setMinPriceDraft] = useState<string | null>(null);
  const [maxPriceDraft, setMaxPriceDraft] = useState<string | null>(null);
  const [minGapDraft, setMinGapDraft] = useState<string | null>(null);
  const [minPmVolDraft, setMinPmVolDraft] = useState<string | null>(null);
  const [minVolPctDraft, setMinVolPctDraft] = useState<string | null>(null);
  const [rowLimitDraft, setRowLimitDraft] = useState<string | null>(null);

  const selectedPresetValue =
    selectedSavedPresetId && (savedPresets ?? []).some((p) => p.id === selectedSavedPresetId)
      ? `saved:${selectedSavedPresetId}`
      : filters.capPreset === "custom"
        ? "custom"
        : filters.capPreset;
  const selectedSavedPreset =
    selectedSavedPresetId && savedPresets ? savedPresets.find((p) => p.id === selectedSavedPresetId) ?? null : null;

  const clearDrafts = useCallback(() => {
    setMcapMinDraft(null);
    setMcapMaxDraft(null);
    setMinPriceDraft(null);
    setMaxPriceDraft(null);
    setMinGapDraft(null);
    setMinPmVolDraft(null);
    setMinVolPctDraft(null);
    setRowLimitDraft(null);
  }, []);

  const setCustomField = <K extends NumericGapperRequestKey>(key: K, value: number) => {
    onSelectSavedPresetId?.(null);
    onFiltersChange({ ...filters, [key]: value, capPreset: "custom" });
  };

  const filtersWithDraftValues = useCallback((): GapperFilterState => {
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
    if (minPrice != null) {
      next = {
        ...next,
        minPrice: Math.max(0.01, Math.min(minPrice, next.maxPrice ?? 50_000_000)),
        capPreset: "custom",
      };
    }

    const maxPrice = maxPriceDraft != null ? parseDecimalBlur(maxPriceDraft) : null;
    if (maxPrice != null) {
      next = {
        ...next,
        maxPrice: Math.min(50_000_000, Math.max(maxPrice, next.minPrice ?? 0.01)),
        capPreset: "custom",
      };
    }

    const minGapPct = minGapDraft != null ? parseDecimalBlur(minGapDraft) : null;
    if (minGapPct != null) next = { ...next, minGapPct: Math.max(0, minGapPct), capPreset: "custom" };

    const minPmVolume = minPmVolDraft != null ? parseFlexibleFilterNumber(minPmVolDraft) : null;
    if (minPmVolume != null) next = { ...next, minPmVolume: Math.max(0, Math.round(minPmVolume)), capPreset: "custom" };

    const minVolPct = minVolPctDraft != null ? parseDecimalBlur(minVolPctDraft) : null;
    if (minVolPct != null) next = { ...next, minVolPct: Math.max(0, minVolPct), capPreset: "custom" };

    const rowLimit = rowLimitDraft != null ? parseFlexibleFilterNumber(rowLimitDraft) : null;
    if (rowLimit != null) next = { ...next, rowLimit: Math.max(1, Math.min(50, Math.round(rowLimit))), capPreset: "custom" };

    return next;
  }, [
    filters,
    mcapMinDraft,
    mcapMaxDraft,
    minPriceDraft,
    maxPriceDraft,
    minGapDraft,
    minPmVolDraft,
    minVolPctDraft,
    rowLimitDraft,
  ]);

  const handlePrimaryAction = useCallback(() => {
    const next = filtersWithDraftValues();
    clearDrafts();
    onSelectSavedPresetId?.(null);
    onFiltersChange(next);
    onPrimaryAction(next);
  }, [clearDrafts, filtersWithDraftValues, onFiltersChange, onPrimaryAction, onSelectSavedPresetId]);

  useImperativeHandle(
    ref,
    () => ({
      applyFiltersAndRunPrimary: handlePrimaryAction,
    }),
    [handlePrimaryAction]
  );

  const applyPreset = (preset: Exclude<GapperCapPreset, "custom">) => {
    clearDrafts();
    onSelectSavedPresetId?.(null);
    const { min, max } = GAPPER_CAP_PRESET_MC[preset];
    onFiltersChange({ ...filters, capPreset: preset, minMarketCap: min, maxMarketCap: max });
  };

  const handleSavePreset = () => {
    if (!onSaveCurrentPreset) return;
    const next = filtersWithDraftValues();
    clearDrafts();
    onSelectSavedPresetId?.(null);
    onFiltersChange(next);
    const defaultName = selectedSavedPresetId
      ? (savedPresets ?? []).find((p) => p.id === selectedSavedPresetId)?.name ?? ""
      : "";
    const raw = window.prompt("Save filter preset as:", defaultName);
    if (raw == null) return;
    const name = raw.trim();
    if (!name) return;
    onSaveCurrentPreset(name, next);
  };

  const handleRenamePreset = () => {
    if (!onRenameSavedPreset || !selectedSavedPreset) return;
    const raw = window.prompt("Rename filter preset:", selectedSavedPreset.name);
    if (raw == null) return;
    const nextName = raw.trim();
    if (!nextName) return;
    onRenameSavedPreset(selectedSavedPreset.id, nextName);
  };

  const handleDeletePreset = () => {
    if (!onDeleteSavedPreset || !selectedSavedPreset) return;
    const ok = window.confirm(`Delete saved preset "${selectedSavedPreset.name}"?`);
    if (!ok) return;
    onDeleteSavedPreset(selectedSavedPreset.id);
  };

  return (
    <div className="flex flex-wrap items-center gap-[14px] px-[14px] py-[10px]" style={{ alignItems: "center" }}>
      <div className="flex items-center gap-1.5">
        <span style={gapFilterLabelStyle}>Preset</span>
        <select
          value={selectedPresetValue}
          onChange={(e) => {
            const value = e.target.value;
            if (value.startsWith("saved:")) {
              clearDrafts();
              const id = value.slice("saved:".length);
              if (!id) return;
              onSelectSavedPresetId?.(id);
              onApplySavedPreset?.(id);
              return;
            }
            if (value === "custom") {
              onSelectSavedPresetId?.(null);
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
          {savedPresets && savedPresets.length > 0 ? (
            <optgroup label="Saved">
              {savedPresets.map((preset) => (
                <option key={preset.id} value={`saved:${preset.id}`}>
                  {preset.name}
                </option>
              ))}
            </optgroup>
          ) : null}
        </select>
        {onSaveCurrentPreset ? (
          <button
            type="button"
            onClick={handleSavePreset}
            className="pm-focus inline-flex h-[30px] w-[30px] items-center justify-center rounded border border-[var(--border-default)] text-[var(--text-secondary)] transition-colors duration-150 hover:border-[rgba(0,229,204,0.45)] hover:bg-[rgba(0,229,204,0.1)] hover:text-[var(--ws-cyan)] active:border-[var(--ws-cyan)] active:bg-[rgba(0,229,204,0.12)] active:text-[var(--ws-cyan)]"
            aria-label="Save current filters as preset"
            title="Save current filters as preset"
          >
            <svg viewBox="0 0 24 24" aria-hidden width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M4 4h13l3 3v13H4z" />
              <path d="M8 4v6h8V4" />
              <path d="M8 20v-6h8v6" />
            </svg>
          </button>
        ) : null}
        {onRenameSavedPreset ? (
          <button
            type="button"
            onClick={handleRenamePreset}
            disabled={!selectedSavedPreset}
            className="pm-focus inline-flex h-[30px] w-[30px] items-center justify-center rounded border border-[var(--border-default)] text-[var(--text-secondary)] transition-colors duration-150 hover:border-[rgba(0,229,204,0.45)] hover:bg-[rgba(0,229,204,0.1)] hover:text-[var(--ws-cyan)] active:border-[var(--ws-cyan)] active:bg-[rgba(0,229,204,0.12)] active:text-[var(--ws-cyan)] disabled:cursor-not-allowed disabled:hover:border-[var(--border-default)] disabled:hover:bg-transparent disabled:hover:text-[var(--text-secondary)] disabled:opacity-45"
            aria-label="Rename selected saved preset"
            title={selectedSavedPreset ? `Rename "${selectedSavedPreset.name}"` : "Select a saved preset to rename"}
          >
            <svg viewBox="0 0 24 24" aria-hidden width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M3 17.25V21h3.75L18.8 8.95l-3.75-3.75z" />
              <path d="M14.98 5.2l3.75 3.75" />
            </svg>
          </button>
        ) : null}
        {onDeleteSavedPreset ? (
          <button
            type="button"
            onClick={handleDeletePreset}
            disabled={!selectedSavedPreset}
            className="pm-focus inline-flex h-[30px] w-[30px] items-center justify-center rounded border border-[var(--border-default)] text-[var(--text-secondary)] transition-colors duration-150 hover:border-[rgba(0,229,204,0.45)] hover:bg-[rgba(0,229,204,0.1)] hover:text-[var(--ws-cyan)] active:border-[var(--ws-cyan)] active:bg-[rgba(0,229,204,0.12)] active:text-[var(--ws-cyan)] disabled:cursor-not-allowed disabled:hover:border-[var(--border-default)] disabled:hover:bg-transparent disabled:hover:text-[var(--text-secondary)] disabled:opacity-45"
            aria-label="Delete selected saved preset"
            title={selectedSavedPreset ? `Delete "${selectedSavedPreset.name}"` : "Select a saved preset to delete"}
          >
            <svg viewBox="0 0 24 24" aria-hidden width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M3 6h18" />
              <path d="M8 6V4h8v2" />
              <path d="M6 6l1 14h10l1-14" />
              <path d="M10 10v7M14 10v7" />
            </svg>
          </button>
        ) : null}
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
            onSelectSavedPresetId?.(null);
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
            onSelectSavedPresetId?.(null);
            onFiltersChange({
              ...filters,
              maxMarketCap: Math.max(value, filters.minMarketCap ?? 0),
              capPreset: "custom",
            });
          }}
        />
      </div>

      <div className="flex items-center gap-1.5">
        <span style={gapFilterLabelStyle}>Price</span>
        <input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          className="text-right outline-none ws-focus-ring focus:border-[#3BBFCF]"
          style={{ ...gapFilterInputStyle, width: 56 }}
          value={minPriceDraft === null ? formatPriceFilterDisplay(filters.minPrice ?? 0.01) : minPriceDraft}
          onFocus={() => setMinPriceDraft(formatPriceFilterDisplay(filters.minPrice ?? 0.01))}
          onChange={(e) => setMinPriceDraft(e.target.value)}
          onBlur={(e) => {
            setMinPriceDraft(null);
            const value = parseDecimalBlur(e.currentTarget.value);
            if (value == null) return;
            onSelectSavedPresetId?.(null);
            const minP = Math.max(0.01, Math.min(value, filters.maxPrice ?? 50_000_000));
            onFiltersChange({ ...filters, minPrice: minP, capPreset: "custom" });
          }}
        />
        <span className="pm-mono" style={{ color: "#8a8a8a", fontSize: "var(--ws-fs-body)" }}>
          -
        </span>
        <input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          className="text-right outline-none ws-focus-ring focus:border-[#3BBFCF]"
          style={{ ...gapFilterInputStyle, width: 72 }}
          value={maxPriceDraft === null ? formatPriceFilterDisplay(filters.maxPrice ?? 50_000_000) : maxPriceDraft}
          onFocus={() => setMaxPriceDraft(formatPriceFilterDisplay(filters.maxPrice ?? 50_000_000))}
          onChange={(e) => setMaxPriceDraft(e.target.value)}
          onBlur={(e) => {
            setMaxPriceDraft(null);
            const value = parseDecimalBlur(e.currentTarget.value);
            if (value == null) return;
            onSelectSavedPresetId?.(null);
            const maxP = Math.min(50_000_000, Math.max(value, filters.minPrice ?? 0.01));
            onFiltersChange({ ...filters, maxPrice: maxP, capPreset: "custom" });
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
          value={minPmVolDraft ?? abbreviateUsdFilterDisplay(filters.minPmVolume ?? 0)}
          onFocus={() => setMinPmVolDraft(formatUsdIntInputDisplay(filters.minPmVolume))}
          onChange={(e) => setMinPmVolDraft(e.target.value)}
          onBlur={(e) => {
            setMinPmVolDraft(null);
            const value = parseFlexibleFilterNumber(e.currentTarget.value);
            if (value != null) setCustomField("minPmVolume", Math.max(0, Math.round(value)));
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

      <div className="flex items-center gap-1.5">
        <span style={gapFilterLabelStyle}>Rows</span>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          className="text-right outline-none ws-focus-ring focus:border-[#3BBFCF]"
          style={{ ...gapFilterInputStyle, width: 60 }}
          value={rowLimitDraft ?? String(filters.rowLimit ?? 10)}
          onFocus={() => setRowLimitDraft(String(filters.rowLimit ?? 10))}
          onChange={(e) => setRowLimitDraft(e.target.value)}
          onBlur={(e) => {
            setRowLimitDraft(null);
            const value = parseFlexibleFilterNumber(e.currentTarget.value);
            if (value != null) setCustomField("rowLimit", Math.max(1, Math.min(50, Math.round(value))));
          }}
        />
      </div>

      <div className="flex items-center gap-1.5">
        <span style={gapFilterLabelStyle}>News Search</span>
        <button
          type="button"
          onClick={() => {
            onSelectSavedPresetId?.(null);
            onFiltersChange({ ...filters, includeNews: !(filters.includeNews !== false) });
          }}
          className={`pm-focus inline-flex h-[30px] items-center rounded border px-2.5 font-medium transition-colors duration-150 ${
            filters.includeNews !== false
              ? "border-[var(--ws-cyan)] bg-[rgba(0,229,204,0.12)] text-[var(--ws-cyan)] hover:bg-[rgba(0,229,204,0.18)]"
              : "border-[var(--border-default)] bg-transparent text-[var(--text-secondary)] hover:border-[rgba(0,229,204,0.45)] hover:bg-[rgba(0,229,204,0.08)] hover:text-[var(--ws-cyan)]"
          }`}
          style={{ fontFamily: "var(--ws-font-sans)", fontSize: "var(--ws-fs-label)" }}
          aria-pressed={filters.includeNews !== false}
          title={filters.includeNews !== false ? "Disable headline search on scans" : "Enable headline search on scans"}
        >
          {filters.includeNews !== false ? "On" : "Off"}
        </button>
      </div>

      {!hidePrimaryButton ? (
        <>
          <div className="min-w-2 flex-1" aria-hidden />
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={handlePrimaryAction}
            disabled={loading}
            className="shrink-0 rounded border border-[var(--border-default)] bg-transparent font-medium text-[var(--text-secondary)] transition-colors duration-150 ws-focus-ring hover:border-[rgba(0,229,204,0.45)] hover:bg-[rgba(0,229,204,0.08)] hover:text-[var(--ws-cyan)] active:border-[var(--ws-cyan)] active:bg-[rgba(0,229,204,0.12)] active:text-[var(--ws-cyan)] disabled:opacity-50"
            style={{
              height: 30,
              padding: "4px 12px",
              fontFamily: "var(--ws-font-sans)",
              fontSize: "var(--ws-fs-label)",
            }}
          >
            {primaryLabel}
          </button>
        </>
      ) : null}

      {onSecondaryRefresh ? (
        <button
          type="button"
          onClick={() => {
            clearDrafts();
            onSecondaryRefresh();
          }}
          disabled={loading}
          className="shrink-0 rounded border border-[var(--border-default)] bg-transparent font-medium text-[var(--text-secondary)] transition-colors duration-150 ws-focus-ring hover:border-[rgba(0,229,204,0.45)] hover:bg-[rgba(0,229,204,0.08)] hover:text-[var(--ws-cyan)] active:border-[var(--ws-cyan)] active:bg-[rgba(0,229,204,0.12)] active:text-[var(--ws-cyan)] disabled:opacity-50"
          style={{
            height: 30,
            padding: "4px 12px",
            fontFamily: "var(--ws-font-sans)",
            fontSize: "var(--ws-fs-title)",
            lineHeight: 1,
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
});

export default GapperFilterControls;
