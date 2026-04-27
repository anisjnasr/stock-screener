"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GapperRow, GappersRequestBody } from "@/types/gappers";
import type { PythonNewsItem } from "@/lib/python-service";
import type { StocksInPlaySuccess } from "@/types/stocks-in-play";
import type { SipCatalyst } from "@/types/sip-catalyst";
import {
  gapperFilterStateToRequestBody,
  loadSavedSipMidLargeFilterPresetsFromStorage,
  loadSavedSipSmallCapFilterPresetsFromStorage,
  loadSipMidLargeGapperFiltersFromStorage,
  loadSipSmallCapGapperFiltersFromStorage,
  saveSavedSipMidLargeFilterPresetsToStorage,
  saveSavedSipSmallCapFilterPresetsToStorage,
  saveSipMidLargeGapperFiltersToStorage,
  saveSipSmallCapGapperFiltersToStorage,
  type GapperFilterState,
  type SavedGapperFilterPreset,
} from "@/components/premarket/gapper-filters-storage";
import CollapsibleSection from "@/components/premarket/CollapsibleSection";
import GapperFilterControls, { type GapperFilterControlsRef } from "@/components/premarket/GapperFilterControls";
import { ymdInEt } from "@/lib/et-ymd";
import SipPlayRowsTable from "@/components/premarket/SipPlayRowsTable";
import {
  loadSipDaySnapshot,
  mergeKeyedRecords,
  mergeMidLargeRows,
  saveSipDaySnapshot,
  snapshotFromSuccess,
  type SipPersistVariant,
} from "@/lib/premarket/sip-daily-persistence";
import { SIP_MAX_TICKERS, SIP_SMALL_CAP_MAX_TICKERS } from "@/lib/premarket/sip-constants";
import {
  PREMARKET_SIP_FILTERS_CHANGED_LEGACY,
  PREMARKET_SIP_MID_LARGE_FILTERS_CHANGED,
  PREMARKET_SIP_SMALL_CAP_FILTERS_CHANGED,
} from "@/lib/premarket/sip-events";

function makePresetId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type StocksInPlayProps = {
  sectionLabel?: string;
  collapsed: boolean;
  onToggle: () => void;
  onOpenTickerInLists?: (sym: string) => void;
};

type SipVariantBlockProps = {
  title: string;
  apiPath: string;
  sipVariant: SipPersistVariant;
  filtersChangedEventName: string;
  primaryLabel: string;
  maxRows: number;
  emptyNewsText?: string;
  onOpenTickerInLists?: (sym: string) => void;
  loadFilters: () => GapperFilterState;
  saveFilters: (f: GapperFilterState) => void;
  loadPresets: () => SavedGapperFilterPreset[];
  savePresets: (presets: SavedGapperFilterPreset[]) => void;
};

function SipVariantBlock({
  title,
  apiPath,
  sipVariant,
  filtersChangedEventName,
  primaryLabel,
  maxRows,
  emptyNewsText,
  onOpenTickerInLists,
  loadFilters,
  saveFilters,
  loadPresets,
  savePresets,
}: SipVariantBlockProps) {
  const [rows, setRows] = useState<GapperRow[] | null>(null);
  const [news, setNews] = useState<Record<string, PythonNewsItem[]> | null>(null);
  const [catalyst, setCatalyst] = useState<Record<string, SipCatalyst> | null>(null);
  const [catalystError, setCatalystError] = useState<string | null>(null);
  const [pythonConfigured, setPythonConfigured] = useState(false);
  const [newsError, setNewsError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [tableCollapsed, setTableCollapsed] = useState(false);
  const [sipFilters, setSipFilters] = useState<GapperFilterState>(() => loadFilters());
  const [savedPresets, setSavedPresets] = useState<SavedGapperFilterPreset[]>(() => loadPresets());
  const [selectedSavedPresetId, setSelectedSavedPresetId] = useState<string | null>(null);
  const filtersRef = useRef(sipFilters);
  filtersRef.current = sipFilters;
  const filterControlsRef = useRef<GapperFilterControlsRef>(null);
  const rowsRef = useRef<GapperRow[] | null>(null);
  rowsRef.current = rows;
  const newsRef = useRef<Record<string, PythonNewsItem[]> | null>(null);
  newsRef.current = news;
  const catalystRef = useRef<Record<string, SipCatalyst> | null>(null);
  catalystRef.current = catalyst;

  useEffect(() => {
    const etYmd = ymdInEt();
    const snap = loadSipDaySnapshot(etYmd, sipVariant);
    if (!snap) return;
    setRows(snap.rows);
    setNews(snap.news);
    setCatalyst(snap.catalyst);
    setNewsError(snap.newsError);
    setCatalystError(snap.catalystError);
    setPythonConfigured(snap.pythonConfigured);
  }, [sipVariant]);

  const load = useCallback(
    async (signal: AbortSignal, scanBody: GappersRequestBody): Promise<boolean> => {
      setLoading(true);
      setError(null);
      setNewsError(null);
      setCatalystError(null);
      try {
        const res = await fetch(apiPath, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(scanBody),
          cache: "no-store",
          signal,
        });
        const json = (await res.json()) as StocksInPlaySuccess | { ok?: false; error?: string };
        if (!res.ok || !json.ok) {
          setPythonConfigured(false);
          setError((json as { error?: string }).error ?? res.statusText);
          return false;
        }
        const ok = json as StocksInPlaySuccess;
        const apiRows = ok.rows ?? [];
        const etYmd = ymdInEt();

        let nextRows: GapperRow[];
        let nextNews: Record<string, PythonNewsItem[]> | null;
        let nextCatalyst: Record<string, SipCatalyst> | null;

        if (sipVariant === "mid-large") {
          nextRows = mergeMidLargeRows(rowsRef.current ?? [], apiRows);
          nextNews = mergeKeyedRecords(newsRef.current, ok.news);
          nextCatalyst = mergeKeyedRecords(catalystRef.current, ok.catalyst);
        } else {
          nextRows = apiRows.slice(0, maxRows);
          nextNews = ok.news ?? null;
          nextCatalyst = ok.catalyst ?? null;
        }

        setRows(nextRows);
        setNews(nextNews);
        setCatalyst(nextCatalyst);
        setCatalystError(ok.catalystError ?? null);
        setPythonConfigured(ok.pythonConfigured);
        setNewsError(ok.newsError ?? null);

        const snap = snapshotFromSuccess(etYmd, nextRows, {
          ...ok,
          rows: nextRows,
          news: nextNews,
          catalyst: nextCatalyst,
        });
        saveSipDaySnapshot(snap, sipVariant);

        return true;
      } catch (e) {
        if ((e as Error).name === "AbortError") return false;
        setError(e instanceof Error ? e.message : "Failed to load");
        return false;
      } finally {
        setLoading(false);
      }
    },
    [apiPath, maxRows, sipVariant]
  );

  const updateSipFilters = useCallback(
    (next: GapperFilterState) => {
      setSelectedSavedPresetId(null);
      setSipFilters(next);
      saveFilters(next);
      window.dispatchEvent(new CustomEvent(filtersChangedEventName));
      if (filtersChangedEventName === PREMARKET_SIP_MID_LARGE_FILTERS_CHANGED) {
        window.dispatchEvent(new CustomEvent(PREMARKET_SIP_FILTERS_CHANGED_LEGACY));
      }
    },
    [filtersChangedEventName, saveFilters]
  );

  const refreshSip = useCallback(() => {
    const ac = new AbortController();
    void load(ac.signal, gapperFilterStateToRequestBody(filtersRef.current));
  }, [load]);

  const refreshSipWithFilters = useCallback(
    (next: GapperFilterState) => {
      updateSipFilters(next);
      const ac = new AbortController();
      void load(ac.signal, gapperFilterStateToRequestBody(next));
    },
    [load, updateSipFilters]
  );

  const applySavedPreset = useCallback(
    (presetId: string) => {
      const preset = savedPresets.find((p) => p.id === presetId);
      if (!preset) return;
      setSelectedSavedPresetId(preset.id);
      setSipFilters(preset.filters);
      saveFilters(preset.filters);
      window.dispatchEvent(new CustomEvent(filtersChangedEventName));
      if (filtersChangedEventName === PREMARKET_SIP_MID_LARGE_FILTERS_CHANGED) {
        window.dispatchEvent(new CustomEvent(PREMARKET_SIP_FILTERS_CHANGED_LEGACY));
      }
      const ac = new AbortController();
      void load(ac.signal, gapperFilterStateToRequestBody(preset.filters));
    },
    [filtersChangedEventName, load, saveFilters, savedPresets]
  );

  const saveCurrentPreset = useCallback(
    (name: string, next: GapperFilterState) => {
      const normalizedName = name.trim();
      if (!normalizedName) return;
      const normalizedFilters: GapperFilterState = { ...next, capPreset: "custom" };
      const existing = savedPresets.find((p) => p.name.toLowerCase() === normalizedName.toLowerCase());
      const entry: SavedGapperFilterPreset = existing
        ? { ...existing, name: normalizedName, filters: normalizedFilters }
        : { id: makePresetId(), name: normalizedName, filters: normalizedFilters };
      const nextList = [entry, ...savedPresets.filter((p) => p.id !== entry.id)];
      setSavedPresets(nextList);
      savePresets(nextList);
      setSelectedSavedPresetId(entry.id);
      setSipFilters(normalizedFilters);
      saveFilters(normalizedFilters);
      window.dispatchEvent(new CustomEvent(filtersChangedEventName));
      if (filtersChangedEventName === PREMARKET_SIP_MID_LARGE_FILTERS_CHANGED) {
        window.dispatchEvent(new CustomEvent(PREMARKET_SIP_FILTERS_CHANGED_LEGACY));
      }
    },
    [filtersChangedEventName, saveFilters, savePresets, savedPresets]
  );

  const renameSavedPreset = useCallback(
    (presetId: string, nextName: string) => {
      const normalizedName = nextName.trim();
      if (!normalizedName) return;
      const duplicate = savedPresets.find(
        (p) => p.id !== presetId && p.name.toLowerCase() === normalizedName.toLowerCase()
      );
      if (duplicate) {
        window.alert(`A preset named "${duplicate.name}" already exists.`);
        return;
      }
      const nextList = savedPresets.map((p) => (p.id === presetId ? { ...p, name: normalizedName } : p));
      setSavedPresets(nextList);
      savePresets(nextList);
    },
    [savePresets, savedPresets]
  );

  const deleteSavedPreset = useCallback(
    (presetId: string) => {
      const nextList = savedPresets.filter((p) => p.id !== presetId);
      setSavedPresets(nextList);
      savePresets(nextList);
      setSelectedSavedPresetId((cur) => (cur === presetId ? null : cur));
    },
    [savePresets, savedPresets]
  );

  return (
    <div className="rounded border" style={{ borderColor: "var(--border-default)", background: "var(--bg-panel)" }}>
      <div className="flex min-w-0 items-center gap-2 rounded-t px-3 py-2" style={{ borderColor: "var(--border-default)" }}>
        <button
          type="button"
          className="pm-focus flex min-w-0 flex-1 items-center gap-2.5 text-left transition-colors duration-150 hover:bg-[rgba(0,229,204,0.09)]"
          onClick={() => setTableCollapsed((v) => !v)}
          aria-expanded={!tableCollapsed}
        >
          <span
            aria-hidden
            className="inline-block shrink-0 leading-none transition-transform duration-200 ease-out"
            style={{
              color: "var(--text-secondary)",
              fontSize: "1.375rem",
              transform: tableCollapsed ? "rotate(0deg)" : "rotate(90deg)",
            }}
          >
            ▸
          </span>
          <span className="pm-site-prose min-w-0 font-semibold" style={{ color: "var(--text-primary)" }}>
            {title}
          </span>
        </button>
        {!tableCollapsed ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setFiltersOpen((v) => !v);
              }}
              className={`pm-focus shrink-0 rounded border px-2 py-1 font-medium transition-colors duration-150 ${
                filtersOpen
                  ? "border-[var(--ws-cyan)] bg-[rgba(0,229,204,0.12)] text-[var(--ws-cyan)] hover:bg-[rgba(0,229,204,0.18)]"
                  : "border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[rgba(0,229,204,0.45)] hover:bg-[rgba(0,229,204,0.08)] hover:text-[var(--ws-cyan)]"
              }`}
              style={{
                fontFamily: "var(--ws-font-sans)",
                fontSize: "var(--ws-fs-label)",
              }}
              aria-expanded={filtersOpen}
              aria-pressed={filtersOpen}
            >
              Filters
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (filtersOpen) {
                  filterControlsRef.current?.applyFiltersAndRunPrimary();
                } else {
                  refreshSip();
                }
              }}
              disabled={loading}
              className={`pm-focus inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded border border-[var(--border-default)] bg-transparent text-[var(--text-secondary)] transition-colors duration-150 hover:border-[rgba(0,229,204,0.45)] hover:bg-[rgba(0,229,204,0.08)] hover:text-[var(--ws-cyan)] active:border-[var(--ws-cyan)] active:bg-[rgba(0,229,204,0.12)] active:text-[var(--ws-cyan)] disabled:opacity-50 disabled:hover:border-[var(--border-default)] disabled:hover:bg-transparent disabled:hover:text-[var(--text-secondary)] ${loading ? "[&_svg]:animate-spin" : ""}`}
              aria-busy={loading}
              aria-label={primaryLabel}
              title={primaryLabel}
            >
              <svg viewBox="0 0 24 24" aria-hidden width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                <path d="M21 3v7h-7" />
              </svg>
            </button>
          </div>
        ) : null}
      </div>

      {!tableCollapsed ? (
        <div className="space-y-3 border-t p-3" style={{ borderColor: "var(--border-default)" }}>
          {filtersOpen ? (
            <div className="rounded border" style={{ borderColor: "var(--border-default)", background: "var(--bg-inset)" }}>
              <GapperFilterControls
                ref={filterControlsRef}
                filters={sipFilters}
                onFiltersChange={updateSipFilters}
                onPrimaryAction={refreshSipWithFilters}
                savedPresets={savedPresets}
                selectedSavedPresetId={selectedSavedPresetId}
                onSelectSavedPresetId={setSelectedSavedPresetId}
                onApplySavedPreset={applySavedPreset}
                onSaveCurrentPreset={saveCurrentPreset}
                onRenameSavedPreset={renameSavedPreset}
                onDeleteSavedPreset={deleteSavedPreset}
                primaryLabel={primaryLabel}
                loading={loading}
                hidePrimaryButton
              />
            </div>
          ) : null}

          {error ? (
            <div
              className="rounded border px-3 py-2.5"
              role="alert"
              style={{ borderColor: "var(--border-default)", background: "var(--bg-inset)" }}
            >
              <p className="pm-site-prose font-semibold" style={{ color: "var(--text-primary)" }}>
                Could not load {title}
              </p>
              <p className="pm-site-caption mt-1" style={{ color: "var(--text-secondary)" }}>
                {error}
              </p>
            </div>
          ) : null}

          {loading && !rows?.length ? (
            <p className="pm-site-prose" style={{ color: "var(--text-secondary)" }}>
              Loading gappers, headlines, and catalysts…
            </p>
          ) : null}

          {rows && rows.length > 0 ? (
            <SipPlayRowsTable
              rows={rows}
              news={news}
              catalyst={catalyst}
              pythonConfigured={pythonConfigured}
              newsError={newsError}
              catalystError={catalystError}
              onOpenTickerInLists={onOpenTickerInLists}
              mode="live"
              emptyNewsText={emptyNewsText}
              listMode={sipVariant === "mid-large" ? "cumulative" : "capped"}
              maxTickerDisplay={sipVariant === "mid-large" ? SIP_MAX_TICKERS : SIP_SMALL_CAP_MAX_TICKERS}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default function StocksInPlay({
  sectionLabel = "Stocks in Play",
  collapsed,
  onToggle,
  onOpenTickerInLists,
}: StocksInPlayProps) {
  return (
    <CollapsibleSection
      id="sip"
      label={sectionLabel}
      labelAccent="cyan"
      collapsed={collapsed}
      onToggle={onToggle}
    >
      {!collapsed ? (
        <div className="space-y-3">
          <SipVariantBlock
            title="SIP - Mid-Large Caps"
            apiPath="/api/premarket/stocks-in-play"
            sipVariant="mid-large"
            filtersChangedEventName={PREMARKET_SIP_MID_LARGE_FILTERS_CHANGED}
            primaryLabel="Refresh Mid-Large SIP"
            maxRows={SIP_MAX_TICKERS}
            onOpenTickerInLists={onOpenTickerInLists}
            loadFilters={loadSipMidLargeGapperFiltersFromStorage}
            saveFilters={saveSipMidLargeGapperFiltersToStorage}
            loadPresets={loadSavedSipMidLargeFilterPresetsFromStorage}
            savePresets={saveSavedSipMidLargeFilterPresetsToStorage}
          />
          <SipVariantBlock
            title="SIP - Small Caps"
            apiPath="/api/premarket/stocks-in-play-smallcaps"
            sipVariant="small-cap"
            filtersChangedEventName={PREMARKET_SIP_SMALL_CAP_FILTERS_CHANGED}
            primaryLabel="Refresh Small-Cap SIP"
            maxRows={SIP_SMALL_CAP_MAX_TICKERS}
            emptyNewsText="No news"
            onOpenTickerInLists={onOpenTickerInLists}
            loadFilters={loadSipSmallCapGapperFiltersFromStorage}
            saveFilters={saveSipSmallCapGapperFiltersToStorage}
            loadPresets={loadSavedSipSmallCapFilterPresetsFromStorage}
            savePresets={saveSavedSipSmallCapFilterPresetsToStorage}
          />
        </div>
      ) : null}
    </CollapsibleSection>
  );
}
