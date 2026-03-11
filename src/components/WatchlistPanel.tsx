"use client";

import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import {
  loadWatchlists,
  saveWatchlists,
  loadFlags,
  saveFlags,
  loadColumnWidths,
  saveColumnWidths,
  loadVisibleColumns,
  saveVisibleColumns,
  loadColumnSets,
  saveColumnSets,
  savePanelHeightPx,
  loadSidebarWidthPx,
  saveSidebarWidthPx,
  type Watchlist,
  type StockFlag,
  type ColumnId,
  type ColumnSet,
  ALL_COLUMN_IDS,
  COLUMN_LABELS,
  NUMERIC_COLUMN_IDS,
  DEFAULT_VISIBLE_COLUMNS,
} from "@/lib/watchlist-storage";
import {
  loadScreens,
  addScreen,
  updateScreen,
  deleteScreen,
  loadFolders,
  addFolder,
  updateFolder,
  deleteFolder,
  seedDefaultScreensIfEmpty,
  type SavedScreen,
  type ScreenerFolder,
  type ScreenerFilters,
  UNIVERSE_OPTIONS,
} from "@/lib/screener-storage";
import { formatDisplayDate, formatDisplayDateTime } from "@/lib/date-format";
import { toTitleCase } from "@/lib/text-format";
import { SCREENER_FILTER_CATEGORIES, PCT_OPERATORS, getFilterCriteriaColumns } from "@/lib/screener-fields";
import NinoScriptEditor from "@/components/NinoScriptEditor";
import NinoScriptHelp from "@/components/NinoScriptHelp";

/** Row shape: core fields + all optional screener/quote columns (camelCase). */
type WatchlistRow = {
  symbol: string;
  name: string;
  industry: string;
  sector: string;
  marketCap?: number;
  lastPrice?: number;
  changePct?: number;
  volume?: number;
  avgVolume?: number;
  atrPct?: number;
  exchange?: string | null;
  date?: string;
  high52w?: number | null;
  off52wHighPct?: number | null;
  priceChange1wPct?: number | null;
  priceChange1mPct?: number | null;
  priceChange3mPct?: number | null;
  priceChange6mPct?: number | null;
  priceChange12mPct?: number | null;
  rsVsSpy1w?: number | null;
  rsVsSpy1m?: number | null;
  rsVsSpy3m?: number | null;
  rsVsSpy6m?: number | null;
  rsVsSpy12m?: number | null;
  rsPct1w?: number | null;
  rsPct1m?: number | null;
  rsPct3m?: number | null;
  rsPct6m?: number | null;
  rsPct12m?: number | null;
  industryRank1m?: number | null;
  industryRank3m?: number | null;
  industryRank6m?: number | null;
  industryRank12m?: number | null;
  sectorRank1m?: number | null;
  sectorRank3m?: number | null;
  sectorRank6m?: number | null;
  sectorRank12m?: number | null;
  [key: string]: unknown;
};

const MIN_PANEL_HEIGHT_PX = 32;

/** Predefined index lists (read-only in the Lists tab). Symbols loaded from API when selected. */
const PREDEFINED_LISTS: { id: string; name: string }[] = [
  { id: "nasdaq100", name: "Nasdaq 100" },
  { id: "sp500", name: "S&P 500" },
  { id: "russell2000", name: "Russell 2000" },
];

const WATCHLIST_QUOTES_BATCH_SIZE = 50;

function getMaxPanelHeightPx(): number {
  if (typeof window === "undefined") return 600;
  return Math.max(200, window.innerHeight - 120);
}

const RELATED_LIST_ID = "__related__";

type WatchlistPanelProps = {
  panelHeightPx: number;
  onHeightChange: (px: number) => void;
  onSymbolSelect?: (symbol: string) => void;
  /** When set, "Related Stocks" appears in the Lists tab; clicking the title in the sidebar opens this list. */
  relatedStocksList?: { title: string; symbols: string[] } | null;
  /** When this value changes, panel switches to Lists tab and selects the related list (e.g. Date.now() from parent). */
  openToRelatedListTrigger?: number;
};

function fmtNum(n: number | undefined): string {
  if (n == null || Number.isNaN(n)) return "NA";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toLocaleString();
}

function fmtPct(n: number | undefined): string {
  if (n == null || Number.isNaN(n)) return "NA";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

/** Table column id: standard ColumnId or script criterion label (e.g. "MA(C, 21)"). */
type TableColumnId = ColumnId | string;

function getRowValue(row: WatchlistRow, col: TableColumnId): unknown {
  if (col === "ticker") return row.symbol;
  return row[col];
}

function formatCellValue(row: WatchlistRow, col: TableColumnId, isScriptColumn?: boolean): string {
  const v = getRowValue(row, col);
  if (v == null || v === "") return "NA";
  if (isScriptColumn && typeof v === "number") {
    if (String(col).includes("ATRP") || String(col).includes("Pct")) return `${(v * 100).toFixed(2)}%`;
    return Number.isInteger(v) ? v.toLocaleString() : v.toFixed(4);
  }
  if (col === "lastPrice") return typeof v === "number" ? `$${v.toFixed(2)}` : String(v);
  if (col === "date") return formatDisplayDate(String(v));
  if (col === "industry") return toTitleCase(String(v));
  if (col === "changePct" || col === "atrPct" || (typeof v === "number" && String(col).includes("Pct")))
    return typeof v === "number" ? (col === "changePct" ? fmtPct(v) : `${v.toFixed(2)}%`) : String(v);
  if (typeof v === "number") {
    if (col === "marketCap" || col === "volume" || col === "avgVolume") return fmtNum(v);
    return Number.isInteger(v) ? v.toLocaleString() : v.toFixed(2);
  }
  return String(v);
}

function getColumnLabel(col: TableColumnId): string {
  return (COLUMN_LABELS as Record<string, string>)[col] ?? String(col);
}

function ColumnPickerContent({
  visibleColumns,
  columnSets,
  onSave,
  onReset,
  onCancel,
  onApplySet,
  onSaveSet,
  onDeleteSet,
}: {
  visibleColumns: ColumnId[];
  columnSets: ColumnSet[];
  onSave: (columns: ColumnId[], saveAsName?: string) => void;
  onReset: () => void;
  onCancel: () => void;
  onApplySet: (set: ColumnSet) => void;
  onSaveSet: (set: ColumnSet) => void;
  onDeleteSet: (id: string) => void;
}) {
  const [localOrder, setLocalOrder] = useState<ColumnId[]>(() => [...visibleColumns]);
  const [saveAsName, setSaveAsName] = useState("");
  const [selectedSetId, setSelectedSetId] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [editingSetId, setEditingSetId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  useEffect(() => {
    setLocalOrder([...visibleColumns]);
  }, [visibleColumns]);

  const hidden = useMemo(
    () => ALL_COLUMN_IDS.filter((id) => !localOrder.includes(id)),
    [localOrder]
  );

  const toggleVisible = (col: ColumnId) => {
    setLocalOrder((prev) =>
      prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]
    );
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    e.dataTransfer.setData("text/plain", String(index));
    e.dataTransfer.effectAllowed = "move";
    setDragIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropIndex(index);
  };

  const handleDragLeave = () => setDropIndex(null);
  const handleDragEnd = () => {
    setDragIndex(null);
    setDropIndex(null);
  };

  const handleDrop = (e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    const fromIndex = parseInt(e.dataTransfer.getData("text/plain"), 10);
    if (Number.isNaN(fromIndex) || fromIndex === toIndex) {
      setDragIndex(null);
      setDropIndex(null);
      return;
    }
    setLocalOrder((prev) => {
      const next = [...prev];
      const [removed] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, removed);
      return next;
    });
    setDragIndex(null);
    setDropIndex(null);
  };

  const selectedSet = selectedSetId ? columnSets.find((s) => s.id === selectedSetId) : null;

  const handleSave = () => {
    onSave(localOrder, saveAsName.trim() || undefined);
    setSaveAsName("");
  };

  const handleApplySet = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    setSelectedSetId(id || null);
    if (id) {
      const set = columnSets.find((s) => s.id === id);
      if (set) onApplySet(set);
    }
  };

  const startEditSet = () => {
    if (!selectedSet) return;
    setEditingSetId(selectedSet.id);
    setEditingName(selectedSet.name);
  };

  const confirmEditSet = () => {
    if (editingSetId && editingName.trim()) {
      const set = columnSets.find((s) => s.id === editingSetId);
      if (set) onSaveSet({ ...set, name: editingName.trim() });
      setEditingSetId(null);
      setEditingName("");
    }
  };

  const handleDeleteSet = () => {
    if (selectedSetId && (typeof window === "undefined" || window.confirm("Delete this column set?"))) {
      onDeleteSet(selectedSetId);
      setSelectedSetId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Column set selector */}
      <div>
        <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Column set</h3>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedSetId ?? ""}
            onChange={handleApplySet}
            className="rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-2 py-1.5 text-sm text-zinc-900 dark:text-zinc-100 min-w-[10rem]"
          >
            <option value="">— None —</option>
            {columnSets.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={startEditSet}
            disabled={!selectedSet}
            className="px-2 py-1 rounded bg-zinc-200 dark:bg-zinc-600 text-zinc-800 dark:text-zinc-200 text-sm disabled:opacity-50"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={handleDeleteSet}
            disabled={!selectedSet}
            className="px-2 py-1 rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 text-sm disabled:opacity-50"
          >
            Delete
          </button>
        </div>
        {editingSetId && (
          <div className="mt-2 flex items-center gap-2">
            <input
              type="text"
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              placeholder="Set name"
              className="flex-1 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-2 py-1 text-sm"
            />
            <button type="button" onClick={confirmEditSet} className="px-2 py-1 rounded bg-blue-600 text-white text-sm">OK</button>
            <button type="button" onClick={() => setEditingSetId(null)} className="px-2 py-1 rounded bg-zinc-200 dark:bg-zinc-600 text-sm">Cancel</button>
          </div>
        )}
      </div>

      {/* Visible columns: checkboxes + drag to reorder */}
      <div>
        <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Visible (order) — drag to reorder</h3>
        <ul className="space-y-0.5 max-h-48 overflow-y-auto border border-zinc-200 dark:border-zinc-600 rounded p-1 bg-zinc-50 dark:bg-zinc-900">
          {localOrder.map((col, idx) => (
            <li
              key={col}
              draggable
              onDragStart={(e) => handleDragStart(e, idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDragLeave={handleDragLeave}
              onDragEnd={handleDragEnd}
              onDrop={(e) => handleDrop(e, idx)}
              className={`flex items-center gap-2 py-1 px-1 rounded ${dragIndex === idx ? "opacity-50" : ""} ${dropIndex === idx ? "ring-1 ring-blue-500 bg-blue-50/50 dark:bg-blue-900/20" : ""}`}
            >
              <input
                type="checkbox"
                checked
                onChange={() => toggleVisible(col)}
                className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-600"
                aria-label={`Hide ${COLUMN_LABELS[col]}`}
              />
              <span className="flex-1 text-sm text-zinc-900 dark:text-zinc-100 truncate cursor-grab active:cursor-grabbing">
                {COLUMN_LABELS[col]}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Hidden columns: checkboxes to add */}
      <div>
        <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Hidden</h3>
        <ul className="space-y-0.5 max-h-40 overflow-y-auto border border-zinc-200 dark:border-zinc-600 rounded p-1 bg-zinc-50 dark:bg-zinc-900">
          {hidden.map((col) => (
            <li key={col} className="flex items-center gap-2 py-1 px-1">
              <input
                type="checkbox"
                checked={false}
                onChange={() => toggleVisible(col)}
                className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-600"
                aria-label={`Show ${COLUMN_LABELS[col]}`}
              />
              <span className="text-sm text-zinc-600 dark:text-zinc-400 truncate">{COLUMN_LABELS[col]}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Save as set name + actions */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={saveAsName}
          onChange={(e) => setSaveAsName(e.target.value)}
          placeholder="Save as column set (optional)"
          className="rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-2 py-1.5 text-sm w-48"
        />
        <button
          type="button"
          onClick={handleSave}
          className="px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 text-sm font-medium"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onReset}
          className="px-3 py-1.5 rounded bg-zinc-200 dark:bg-zinc-600 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-300 dark:hover:bg-zinc-500 text-sm"
        >
          Reset to default
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 rounded bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-600 text-sm"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function WatchlistPanel({
  panelHeightPx,
  onHeightChange,
  onSymbolSelect,
  relatedStocksList,
  openToRelatedListTrigger,
}: WatchlistPanelProps) {
  const [lists, setLists] = useState<Watchlist[]>([]);
  const [activeListId, setActiveListId] = useState<string | null>(null);
  const [rows, setRows] = useState<WatchlistRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [flags, setFlags] = useState<Record<string, StockFlag>>({});
  const [selectedSymbols, setSelectedSymbols] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<TableColumnId | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [columnWidths, setColumnWidths] = useState<Partial<Record<ColumnId, number>>>({});
  const [visibleColumns, setVisibleColumns] = useState<ColumnId[]>(() => loadVisibleColumns());
  const [columnSets, setColumnSets] = useState<ColumnSet[]>([]);
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [resizingCol, setResizingCol] = useState<TableColumnId | null>(null);
  const [colDragIndex, setColDragIndex] = useState<number | null>(null);
  const [colDropIndex, setColDropIndex] = useState<number | null>(null);
  const [showAddToListMenu, setShowAddToListMenu] = useState(false);
  const [flagPickerSymbol, setFlagPickerSymbol] = useState<string | null>(null);
  const [sidebarTab, setSidebarTab] = useState<"watchlists" | "lists" | "screener">("watchlists");
  const [selectedPredefinedListId, setSelectedPredefinedListId] = useState<string | null>(null);
  const [predefinedListSymbols, setPredefinedListSymbols] = useState<Record<string, string[]>>({});
  const [predefinedListSymbolsLoading, setPredefinedListSymbolsLoading] = useState(false);
  const [screens, setScreens] = useState<SavedScreen[]>([]);
  const [folders, setFolders] = useState<ScreenerFolder[]>([]);
  /** Folder ids that are expanded in the screener sidebar. */
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(() => new Set());
  const [selectedScreenId, setSelectedScreenId] = useState<string | null>(null);
  const [editingScreenId, setEditingScreenId] = useState<string | null>(null);
  const [showNewScreenerModal, setShowNewScreenerModal] = useState(false);
  const [showScreenerAddMenu, setShowScreenerAddMenu] = useState(false);
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [showNewScriptModal, setShowNewScriptModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newScriptName, setNewScriptName] = useState("");
  const [newScriptBody, setNewScriptBody] = useState("");
  /** When set, New Script modal is in edit mode for this screen id. */
  const [editingScriptScreenId, setEditingScriptScreenId] = useState<string | null>(null);
  const [showNinoScriptHelp, setShowNinoScriptHelp] = useState(false);
  const screenerAddMenuRef = useRef<HTMLDivElement>(null);
  /** When dragging a screen to move it between folders. */
  const [draggedScreenId, setDraggedScreenId] = useState<string | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [dragOverRoot, setDragOverRoot] = useState(false);
  const [screenerModalPosition, setScreenerModalPosition] = useState<{ x: number; y: number } | null>(null);
  const screenerModalRef = useRef<HTMLDivElement>(null);
  const screenerModalDragStart = useRef<{ clientX: number; clientY: number; left: number; top: number } | null>(null);
  const [newScreenForm, setNewScreenForm] = useState<{
    name: string;
    universe: string;
    filters: ScreenerFilters;
    pctOperatorRows?: Record<string, { operator: string; value: string }>;
    includeExcludeRows?: Record<string, { mode: "include" | "exclude"; selected: string[] }>;
    expandedSections?: Record<string, boolean>;
  }>({
    name: "",
    universe: "all",
    filters: {},
    pctOperatorRows: {},
    includeExcludeRows: {},
    expandedSections: Object.fromEntries(SCREENER_FILTER_CATEGORIES.map((c) => [c.id, c.defaultCollapsed ?? true])),
  });
  const [selectedScreenerSectionId, setSelectedScreenerSectionId] = useState<string | null>(
    SCREENER_FILTER_CATEGORIES[0]?.id ?? null
  );
  const [screenerDbDate, setScreenerDbDate] = useState<string | null>(null);
  const [screenerResultCount, setScreenerResultCount] = useState<number | null>(null);
  const [screenerError, setScreenerError] = useState<string | null>(null);
  /** For script screeners: column labels from the script (e.g. "MA(C, 21)", "ATR(10)"). */
  const [scriptColumns, setScriptColumns] = useState<string[]>([]);
  /** Per-screen result count (for showing next to each screener name in the list). */
  const [screenerCounts, setScreenerCounts] = useState<Record<string, number>>({});
  const [addPopupListId, setAddPopupListId] = useState<string | null>(null);
  const [pendingAdds, setPendingAdds] = useState<Array<{ symbol: string; name: string }>>([]);
  const [popupSearchQuery, setPopupSearchQuery] = useState("");
  const [popupSearchResults, setPopupSearchResults] = useState<Array<{ symbol: string; name?: string }>>([]);
  const [popupSearchHighlighted, setPopupSearchHighlighted] = useState(-1);
  const dragStartY = useRef<number>(0);
  const dragStartHeight = useRef<number>(32);
  const lastDraggedHeightPx = useRef<number>(32);
  const isDraggingPanel = useRef(false);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(0);
  const resizeColRef = useRef<TableColumnId | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [sidebarWidthPx, setSidebarWidthPx] = useState(224);
  const sidebarResizeStartX = useRef(0);
  const sidebarResizeStartWidth = useRef(224);
  const lastSidebarWidthPx = useRef(224);
  const isResizingSidebar = useRef(false);
  const addToListMenuRef = useRef<HTMLDivElement>(null);
  const popupSearchInputRef = useRef<HTMLInputElement>(null);

  const selectedScreen = useMemo(
    () => (selectedScreenId ? screens.find((s) => s.id === selectedScreenId) ?? null : null),
    [screens, selectedScreenId]
  );

  const rootScreens = useMemo(
    () => screens.filter((s) => !s.folderId).sort((a, b) => a.name.localeCompare(b.name)),
    [screens]
  );
  const screensByFolderId = useMemo(() => {
    const map: Record<string, SavedScreen[]> = {};
    for (const s of screens) {
      if (s.folderId) {
        if (!map[s.folderId]) map[s.folderId] = [];
        map[s.folderId].push(s);
      }
    }
    for (const arr of Object.values(map)) arr.sort((a, b) => a.name.localeCompare(b.name));
    return map;
  }, [screens]);
  const sortedFolders = useMemo(
    () => [...folders].sort((a, b) => a.name.localeCompare(b.name)),
    [folders]
  );

  const moveScreenToFolder = useCallback((screenId: string, folderId: string | null) => {
    updateScreen(screenId, { folderId: folderId ?? undefined });
    setScreens(loadScreens());
  }, []);

  const toggleFolderExpanded = useCallback((folderId: string) => {
    setExpandedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }, []);

  // Persist lists and flags from localStorage on mount and when changed
  useEffect(() => {
    setLists(loadWatchlists());
    setFlags(loadFlags());
    setColumnWidths(loadColumnWidths());
    seedDefaultScreensIfEmpty();
    setScreens(loadScreens());
    setFolders(loadFolders());
    setColumnSets(loadColumnSets());
    setSidebarWidthPx(loadSidebarWidthPx());
  }, []);

  // Close screener add menu when clicking outside
  useEffect(() => {
    if (!showScreenerAddMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (screenerAddMenuRef.current && !screenerAddMenuRef.current.contains(e.target as Node)) {
        setShowScreenerAddMenu(false);
      }
    };
    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, [showScreenerAddMenu]);

  const MIN_SIDEBAR_WIDTH_PX = 160;
  const MAX_SIDEBAR_WIDTH_PX = 420;
  const startSidebarResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingSidebar.current = true;
    sidebarResizeStartX.current = e.clientX;
    sidebarResizeStartWidth.current = sidebarWidthPx;
    const onMove = (e: MouseEvent) => {
      if (!isResizingSidebar.current) return;
      const dx = e.clientX - sidebarResizeStartX.current;
      const next = Math.min(MAX_SIDEBAR_WIDTH_PX, Math.max(MIN_SIDEBAR_WIDTH_PX, sidebarResizeStartWidth.current + dx));
      lastSidebarWidthPx.current = next;
      setSidebarWidthPx(next);
    };
    const onUp = () => {
      if (!isResizingSidebar.current) return;
      isResizingSidebar.current = false;
      saveSidebarWidthPx(lastSidebarWidthPx.current);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [sidebarWidthPx]);

  const activeList = useMemo(
    () => lists.find((l) => l.id === activeListId) ?? lists[0] ?? null,
    [lists, activeListId]
  );

  useEffect(() => {
    if (lists.length > 0 && !activeListId) setActiveListId(lists[0].id);
    else if (activeListId && !lists.find((l) => l.id === activeListId))
      setActiveListId(lists[0]?.id ?? null);
  }, [lists, activeListId]);

  useEffect(() => {
    saveWatchlists(lists);
  }, [lists]);

  // Fetch predefined index constituents when user selects a list and we don't have them yet
  useEffect(() => {
    if (
      selectedPredefinedListId == null ||
      !PREDEFINED_LISTS.some((p) => p.id === selectedPredefinedListId) ||
      predefinedListSymbols[selectedPredefinedListId] != null
    ) {
      return;
    }
    let cancelled = false;
    setPredefinedListSymbolsLoading(true);
    fetch(`/api/index-constituents?index=${encodeURIComponent(selectedPredefinedListId)}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load constituents");
        return res.json();
      })
      .then((symbols: string[]) => {
        if (!cancelled && Array.isArray(symbols)) {
          setPredefinedListSymbols((prev) => ({
            ...prev,
            [selectedPredefinedListId]: symbols.map((s) => String(s).toUpperCase()),
          }));
        }
      })
      .catch(() => {
        if (!cancelled) setPredefinedListSymbols((prev) => ({ ...prev, [selectedPredefinedListId]: [] }));
      })
      .finally(() => {
        if (!cancelled) setPredefinedListSymbolsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPredefinedListId, predefinedListSymbols]);

  const tableSource = useMemo(() => {
    if (sidebarTab === "watchlists") {
      return { symbols: activeList?.symbols ?? [], title: activeList?.name ?? "—", fromScreener: false, screen: null as SavedScreen | null };
    }
    if (sidebarTab === "screener") {
      if (selectedScreen) return { symbols: [], title: selectedScreen.name, fromScreener: true, screen: selectedScreen };
      return { symbols: [], title: "Screener", fromScreener: false, screen: null };
    }
    if (selectedPredefinedListId === RELATED_LIST_ID && relatedStocksList) {
      return { symbols: relatedStocksList.symbols, title: relatedStocksList.title, fromScreener: false, screen: null };
    }
    const pre = PREDEFINED_LISTS.find((p) => p.id === selectedPredefinedListId);
    if (pre) {
      const symbols = predefinedListSymbols[pre.id] ?? [];
      return { symbols, title: pre.name, fromScreener: false, screen: null };
    }
    return { symbols: [] as string[], title: "Select a list", fromScreener: false, screen: null };
  }, [sidebarTab, activeList, selectedPredefinedListId, relatedStocksList, predefinedListSymbols, selectedScreen]);

  // When parent triggers "open to related list" (sidebar "Related Stocks" click only), switch to Lists tab and select related list.
  // Only depend on openToRelatedListTrigger so that clicking a ticker in the panel (which updates relatedStocksList) does not switch the view.
  useEffect(() => {
    if (openToRelatedListTrigger == null) return;
    setSidebarTab("lists");
    setSelectedPredefinedListId(RELATED_LIST_ID);
  }, [openToRelatedListTrigger]);

  const mapItemToRow = useCallback(
    (item: {
      symbol: string;
      quote: { name?: string; price?: number; changesPercentage?: number; volume?: number; avgVolume?: number; marketCap?: number } | null;
      profile: { companyName?: string; industry?: string; sector?: string; mktCap?: number } | null;
    }): WatchlistRow => ({
      symbol: item.symbol,
      name:
        item.profile?.companyName ??
        item.quote?.name ??
        item.symbol,
      marketCap: item.quote?.marketCap ?? item.profile?.mktCap,
      lastPrice: item.quote?.price,
      changePct: item.quote?.changesPercentage,
      volume: item.quote?.volume,
      avgVolume: item.quote?.avgVolume,
      atrPct: undefined,
      industry: item.profile?.industry ?? "NA",
      sector: item.profile?.sector ?? "NA",
    }),
    []
  );

  /** Map screener API row (from DB) to WatchlistRow. Used by screener and by watchlist/lists when using DB. scriptCols: when present (script screener), copy those keys from r into the row. */
  const mapScreenerRowToWatchlistRow = useCallback(
    (r: Record<string, unknown>, scriptCols?: string[]): WatchlistRow => ({
    symbol: String(r.symbol ?? ""),
    name: String(r.name ?? r.symbol ?? ""),
    industry: r.industry != null ? String(r.industry) : "NA",
    sector: r.sector != null ? String(r.sector) : "NA",
    marketCap: typeof r.market_cap === "number" ? r.market_cap : undefined,
    lastPrice: typeof r.last_price === "number" ? r.last_price : undefined,
    changePct: typeof r.change_pct === "number" ? r.change_pct : undefined,
    volume: typeof r.volume === "number" ? r.volume : undefined,
    avgVolume: typeof r.avg_volume_30d_shares === "number" ? r.avg_volume_30d_shares : undefined,
    atrPct: typeof r.atr_pct_21d === "number" ? r.atr_pct_21d : undefined,
    exchange: r.exchange != null ? String(r.exchange) : null,
    date: r.date != null ? String(r.date) : undefined,
    high52w: typeof r.high_52w === "number" ? r.high_52w : null,
    off52wHighPct: typeof r.off_52w_high_pct === "number" ? r.off_52w_high_pct : null,
    priceChange1wPct: typeof r.price_change_1w_pct === "number" ? r.price_change_1w_pct : null,
    priceChange1mPct: typeof r.price_change_1m_pct === "number" ? r.price_change_1m_pct : null,
    priceChange3mPct: typeof r.price_change_3m_pct === "number" ? r.price_change_3m_pct : null,
    priceChange6mPct: typeof r.price_change_6m_pct === "number" ? r.price_change_6m_pct : null,
    priceChange12mPct: typeof r.price_change_12m_pct === "number" ? r.price_change_12m_pct : null,
    rsVsSpy1w: typeof r.rs_vs_spy_1w === "number" ? r.rs_vs_spy_1w : null,
    rsVsSpy1m: typeof r.rs_vs_spy_1m === "number" ? r.rs_vs_spy_1m : null,
    rsVsSpy3m: typeof r.rs_vs_spy_3m === "number" ? r.rs_vs_spy_3m : null,
    rsVsSpy6m: typeof r.rs_vs_spy_6m === "number" ? r.rs_vs_spy_6m : null,
    rsVsSpy12m: typeof r.rs_vs_spy_12m === "number" ? r.rs_vs_spy_12m : null,
    rsPct1w: typeof r.rs_pct_1w === "number" ? r.rs_pct_1w : null,
    rsPct1m: typeof r.rs_pct_1m === "number" ? r.rs_pct_1m : null,
    rsPct3m: typeof r.rs_pct_3m === "number" ? r.rs_pct_3m : null,
    rsPct6m: typeof r.rs_pct_6m === "number" ? r.rs_pct_6m : null,
    rsPct12m: typeof r.rs_pct_12m === "number" ? r.rs_pct_12m : null,
    industryRank1m: typeof r.industry_rank_1m === "number" ? r.industry_rank_1m : null,
    industryRank3m: typeof r.industry_rank_3m === "number" ? r.industry_rank_3m : null,
    industryRank6m: typeof r.industry_rank_6m === "number" ? r.industry_rank_6m : null,
    industryRank12m: typeof r.industry_rank_12m === "number" ? r.industry_rank_12m : null,
    sectorRank1m: typeof r.sector_rank_1m === "number" ? r.sector_rank_1m : null,
    sectorRank3m: typeof r.sector_rank_3m === "number" ? r.sector_rank_3m : null,
    sectorRank6m: typeof r.sector_rank_6m === "number" ? r.sector_rank_6m : null,
    sectorRank12m: typeof r.sector_rank_12m === "number" ? r.sector_rank_12m : null,
    ...(scriptCols?.length
      ? Object.fromEntries(
          scriptCols.map((c) => [c, (r[c] as number) ?? undefined]).filter(([, v]) => v !== undefined)
        )
      : {}),
  }),
    []
  );

  const fetchRowsForSymbols = useCallback(
    async (symbols: string[]) => {
      if (!symbols.length) {
        setRows([]);
        return;
      }
      setLoading(true);
      try {
        const chunks: string[][] = [];
        for (let i = 0; i < symbols.length; i += WATCHLIST_QUOTES_BATCH_SIZE) {
          chunks.push(symbols.slice(i, i + WATCHLIST_QUOTES_BATCH_SIZE));
        }
        // Prefer screener DB for all data points (except real-time); fallback to watchlist-quotes if DB has no data
        const screenerPromises = chunks.map((chunk) => {
          const params = new URLSearchParams();
          params.set("symbols", chunk.join(","));
          params.set("limit", "100");
          return fetch(`/api/screener?${params.toString()}`).then(async (res) => {
            if (!res.ok) return { rows: [] as Record<string, unknown>[] };
            const data = (await res.json()) as { rows?: Array<Record<string, unknown>> };
            return { rows: data.rows ?? [] };
          });
        });
        const screenerResults = await Promise.all(screenerPromises);
        const allScreenerRows = screenerResults.flatMap((r) => r.rows);
        if (allScreenerRows.length > 0) {
          const newRows: WatchlistRow[] = allScreenerRows.map((r) => mapScreenerRowToWatchlistRow(r));
          setRows(newRows);
          setLastRefresh(new Date());
          setLoading(false);
          return;
        }
        // Fallback: use watchlist-quotes (external API) when DB returns no rows
        const results = await Promise.all(
          chunks.map((chunk) =>
            fetch(
              `/api/watchlist-quotes?symbols=${chunk.map((s) => encodeURIComponent(s)).join(",")}`
            ).then((res) => {
              if (!res.ok) throw new Error("Fetch failed");
              return res.json();
            })
          )
        );
        const list = results.flat().filter(Boolean);
        const newRows: WatchlistRow[] = list.map((item: unknown) => mapItemToRow(item as Parameters<typeof mapItemToRow>[0]));
        setRows(newRows);
        setLastRefresh(new Date());
      } catch {
        setRows([]);
      } finally {
        setLoading(false);
      }
    },
    [mapItemToRow, mapScreenerRowToWatchlistRow]
  );

  const fetchScreenerResults = useCallback(async (screen: SavedScreen) => {
    setLoading(true);
    setScreenerError(null);
    try {
      const params = new URLSearchParams();
      params.set("limit", "2000");
      if (screen.type === "script") {
        params.set("scriptBody", screen.scriptBody ?? "");
        params.set("universe", screen.universe ?? "all");
      } else {
        let symbols: string[] | undefined;
        if (screen.universe !== "all") {
          const res = await fetch(`/api/index-constituents?index=${encodeURIComponent(screen.universe)}`);
          if (res.ok) {
            const data = (await res.json()) as string[];
            symbols = Array.isArray(data) ? data.map((s) => String(s).toUpperCase()) : undefined;
          }
        }
        if (symbols && symbols.length > 0) params.set("symbols", symbols.join(","));
        if (Object.keys(screen.filters).length > 0) params.set("filters", JSON.stringify(screen.filters));
      }
      const res = await fetch(`/api/screener?${params.toString()}`);
      if (!res.ok) throw new Error("Screener fetch failed");
      const data = (await res.json()) as {
        date?: string;
        rows?: Array<Record<string, unknown>>;
        scriptColumns?: string[];
        error?: string;
      };
      if (data.error) setScreenerError(data.error);
      const list = data.rows ?? [];
      const cols = screen.type === "script" ? (data.scriptColumns ?? []) : [];
      if (screen.type !== "script") setScriptColumns([]);
      else if (cols.length > 0) setScriptColumns(cols);
      const newRows: WatchlistRow[] = list.map((r) => mapScreenerRowToWatchlistRow(r, cols));
      setRows(newRows);
      setLastRefresh(new Date());
      setScreenerDbDate(data.date ?? null);
      setScreenerResultCount(newRows.length);
      setScreenerCounts((prev) => ({ ...prev, [screen.id]: newRows.length }));
    } catch {
      setRows([]);
      setScriptColumns([]);
      setScreenerDbDate(null);
      setScreenerResultCount(null);
    } finally {
      setLoading(false);
    }
  }, [mapScreenerRowToWatchlistRow]);

  const fetchRows = useCallback(
    () =>
      tableSource.fromScreener && tableSource.screen
        ? fetchScreenerResults(tableSource.screen)
        : fetchRowsForSymbols(tableSource.symbols),
    [fetchRowsForSymbols, fetchScreenerResults, tableSource.fromScreener, tableSource.screen, tableSource.symbols]
  );

  const isMinimized = panelHeightPx <= MIN_PANEL_HEIGHT_PX;

  useEffect(() => {
    if (isMinimized) return;
    if (tableSource.fromScreener && tableSource.screen) {
      fetchScreenerResults(tableSource.screen);
    } else if (tableSource.symbols.length > 0) {
      fetchRowsForSymbols(tableSource.symbols);
    } else {
      setRows([]);
    }
  }, [isMinimized, tableSource.fromScreener, tableSource.screen?.id, tableSource.screen?.type, tableSource.symbols.join(","), fetchRowsForSymbols, fetchScreenerResults]);

  // Popup: search autocomplete when add popup is open
  useEffect(() => {
    if (addPopupListId == null) return;
    if (!popupSearchQuery.trim()) {
      setPopupSearchResults([]);
      return;
    }
    const t = setTimeout(() => {
      fetch(`/api/search-symbol?query=${encodeURIComponent(popupSearchQuery.trim())}`)
        .then((r) => r.json())
        .then((d) => setPopupSearchResults(Array.isArray(d) ? d.slice(0, 12) : []))
        .catch(() => setPopupSearchResults([]));
      setPopupSearchHighlighted(-1);
    }, 200);
    return () => clearTimeout(t);
  }, [addPopupListId, popupSearchQuery]);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (addToListMenuRef.current && !addToListMenuRef.current.contains(e.target as Node))
        setShowAddToListMenu(false);
      if (flagPickerSymbol != null && !(e.target as HTMLElement).closest("[data-flag-picker]"))
        setFlagPickerSymbol(null);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [flagPickerSymbol]);

  const addList = useCallback(() => {
    const name = prompt("List name", "New List");
    if (!name?.trim()) return;
    const id = crypto.randomUUID();
    setLists((prev) => [...prev, { id, name: name.trim(), symbols: [] }]);
    setActiveListId(id);
  }, []);

  const addSymbolToList = useCallback(
    (symbol: string, listId?: string) => {
      const targetId = listId ?? activeListId;
      if (!targetId) return;
      const sym = symbol.toUpperCase();
      setLists((prev) =>
        prev.map((l) =>
          l.id === targetId && !l.symbols.includes(sym)
            ? { ...l, symbols: [...l.symbols, sym] }
            : l
        )
      );
      setShowAddToListMenu(false);
    },
    [activeListId]
  );

  const openAddPopup = useCallback((listId: string) => {
    setAddPopupListId(listId);
    setPendingAdds([]);
    setPopupSearchQuery("");
    setPopupSearchResults([]);
    setPopupSearchHighlighted(-1);
    setTimeout(() => popupSearchInputRef.current?.focus(), 0);
  }, []);

  const closeAddPopup = useCallback(() => {
    setAddPopupListId(null);
    setPendingAdds([]);
    setPopupSearchQuery("");
  }, []);

  const commitPendingToWatchlist = useCallback(() => {
    if (!addPopupListId) return;
    pendingAdds.forEach(({ symbol }) => addSymbolToList(symbol, addPopupListId));
    closeAddPopup();
  }, [addPopupListId, pendingAdds, addSymbolToList, closeAddPopup]);

  const addPendingFromSearch = useCallback(
    (symbol: string, name?: string) => {
      const sym = symbol.toUpperCase();
      if (pendingAdds.some((p) => p.symbol === sym)) return;
      setPendingAdds((prev) => [...prev, { symbol: sym, name: name ?? sym }]);
      setPopupSearchQuery("");
      setPopupSearchResults([]);
      setPopupSearchHighlighted(-1);
      setTimeout(() => popupSearchInputRef.current?.focus(), 0);
    },
    [pendingAdds]
  );

  const removePending = useCallback((symbol: string) => {
    setPendingAdds((prev) => prev.filter((p) => p.symbol !== symbol));
  }, []);

  const removeSymbolsFromList = useCallback(
    (syms: string[]) => {
      if (!activeListId) return;
      const set = new Set(syms.map((s) => s.toUpperCase()));
      setLists((prev) =>
        prev.map((l) =>
          l.id === activeListId
            ? { ...l, symbols: l.symbols.filter((s) => !set.has(s)) }
            : l
        )
      );
      setSelectedSymbols((prev) => {
        const next = new Set(prev);
        syms.forEach((s) => next.delete(s.toUpperCase()));
        return next;
      });
      setShowAddToListMenu(false);
    },
    [activeListId]
  );

  const setFlag = useCallback((symbol: string, flag: StockFlag | null) => {
    setFlags((prev) => {
      const next = { ...prev };
      if (flag) next[symbol.toUpperCase()] = flag;
      else delete next[symbol.toUpperCase()];
      saveFlags(next);
      return next;
    });
  }, []);

  const toggleSelect = useCallback((symbol: string) => {
    setSelectedSymbols((prev) => {
      const next = new Set(prev);
      const s = symbol.toUpperCase();
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedSymbols(new Set(rows.map((r) => r.symbol)));
  }, [rows]);

  const clearSelection = useCallback(() => {
    setSelectedSymbols(new Set());
    setShowAddToListMenu(false);
  }, []);

  const openNewScreenerModal = useCallback(() => {
    setSidebarTab("screener");
    setEditingScreenId(null);
    setScreenerModalPosition(null);
    setNewScreenForm({
      name: "",
      universe: "all",
      filters: {},
      pctOperatorRows: {},
      includeExcludeRows: {},
      expandedSections: Object.fromEntries(SCREENER_FILTER_CATEGORIES.map((c) => [c.id, c.defaultCollapsed ?? true])),
    });
    setShowNewScreenerModal(true);
  }, []);

  const startScreenerModalDrag = useCallback((e: React.MouseEvent) => {
    const el = screenerModalRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const left = screenerModalPosition?.x ?? rect.left;
    const top = screenerModalPosition?.y ?? rect.top;
    setScreenerModalPosition({ x: left, y: top });
    screenerModalDragStart.current = { clientX: e.clientX, clientY: e.clientY, left, top };
  }, [screenerModalPosition]);

  const buildIncludeExcludeRowsFromFilters = useCallback((filters: ScreenerFilters): Record<string, { mode: "include" | "exclude"; selected: string[] }> => {
    const rows: Record<string, { mode: "include" | "exclude"; selected: string[] }> = {};
    for (const cat of SCREENER_FILTER_CATEGORIES) {
      for (const field of cat.fields) {
        if (field.type !== "includeExcludeMulti") continue;
        const includeVal = filters[field.includeKey];
        const excludeVal = filters[field.excludeKey];
        let includeStr = includeVal != null && includeVal !== "" ? String(includeVal).trim() : "";
        let excludeStr = excludeVal != null && excludeVal !== "" ? String(excludeVal).trim() : "";
        if (!includeStr && !excludeStr && field.key === "industry_filter") {
          const oldIndustry = filters.industry;
          if (oldIndustry != null && oldIndustry !== "") includeStr = String(oldIndustry);
        }
        if (!includeStr && !excludeStr && field.key === "sector_filter") {
          const oldSector = filters.sector;
          if (oldSector != null && oldSector !== "") includeStr = String(oldSector);
        }
        if (includeStr) {
          rows[field.key] = { mode: "include", selected: includeStr.split(",").map((s) => s.trim()).filter(Boolean) };
        } else if (excludeStr) {
          rows[field.key] = { mode: "exclude", selected: excludeStr.split(",").map((s) => s.trim()).filter(Boolean) };
        }
      }
    }
    return rows;
  }, []);

  const buildPctOperatorRowsFromFilters = useCallback((filters: ScreenerFilters): Record<string, { operator: string; value: string }> => {
    const rows: Record<string, { operator: string; value: string }> = {};
    for (const cat of SCREENER_FILTER_CATEGORIES) {
      for (const field of cat.fields) {
        if (field.type !== "pctOperatorRow") continue;
        const rawMin = filters[field.minKey];
        const rawMax = filters[field.maxKey];
        if ((rawMin == null || rawMin === "") && (rawMax == null || rawMax === "")) continue;
        const minVal = rawMin != null && rawMin !== "" ? Number(rawMin) : null;
        const maxVal = rawMax != null && rawMax !== "" ? Number(rawMax) : null;
        if (minVal != null && maxVal != null && !Number.isNaN(minVal) && !Number.isNaN(maxVal) && minVal === maxVal) {
          rows[field.key] = { operator: "eq", value: String(minVal) };
        } else if (minVal != null && !Number.isNaN(minVal) && (maxVal == null || Number.isNaN(maxVal))) {
          rows[field.key] = { operator: "gte", value: String(minVal) };
        } else if (maxVal != null && !Number.isNaN(maxVal)) {
          rows[field.key] = { operator: "lte", value: String(maxVal) };
        }
      }
    }
    return rows;
  }, []);

  const openDuplicateScreener = useCallback((screen: SavedScreen) => {
    setSidebarTab("screener");
    setEditingScreenId(null);
    setScreenerModalPosition(null);
    setNewScreenForm({
      name: `Copy of ${screen.name}`,
      universe: screen.universe,
      filters: { ...screen.filters },
      pctOperatorRows: buildPctOperatorRowsFromFilters(screen.filters),
      includeExcludeRows: buildIncludeExcludeRowsFromFilters(screen.filters),
      expandedSections: Object.fromEntries(
        SCREENER_FILTER_CATEGORIES.map((c) => [c.id, c.defaultCollapsed ?? true])
      ),
    });
    setShowNewScreenerModal(true);
  }, [buildPctOperatorRowsFromFilters, buildIncludeExcludeRowsFromFilters]);

  useEffect(() => {
    if (!showNewScreenerModal) return;
    const onMove = (e: MouseEvent) => {
      const start = screenerModalDragStart.current;
      if (!start) return;
      setScreenerModalPosition({
        x: start.left + e.clientX - start.clientX,
        y: start.top + e.clientY - start.clientY,
      });
    };
    const onUp = () => {
      screenerModalDragStart.current = null;
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [showNewScreenerModal]);

  useEffect(() => {
    if (showNewScreenerModal) {
      setSelectedScreenerSectionId(SCREENER_FILTER_CATEGORIES[0]?.id ?? null);
    } else {
      setScreenerResultCount(null);
    }
  }, [showNewScreenerModal]);

  const setNewScreenFilter = useCallback((key: string, value: string | number | undefined) => {
    setNewScreenForm((prev) => {
      const next = { ...prev, filters: { ...prev.filters } };
      if (value === undefined || value === "") delete next.filters[key];
      else next.filters[key] = value;
      return next;
    });
  }, []);

  const setPctOperatorRow = useCallback((rowKey: string, operator: string, value: string) => {
    setNewScreenForm((prev) => ({
      ...prev,
      pctOperatorRows: { ...prev.pctOperatorRows, [rowKey]: { operator, value } },
    }));
  }, []);

  const setIncludeExcludeRow = useCallback((rowKey: string, mode: "include" | "exclude", selected: string[]) => {
    setNewScreenForm((prev) => ({
      ...prev,
      includeExcludeRows: { ...prev.includeExcludeRows, [rowKey]: { mode, selected } },
    }));
  }, []);

  /** Count filled inputs and total fields for a category. Returns { filled, total } for display as "filled/total". */
  const getCategoryCounts = useCallback(
    (cat: (typeof SCREENER_FILTER_CATEGORIES)[0]) => {
      const filters = newScreenForm.filters;
      let filled = 0;
      for (const field of cat.fields) {
        if (field.type === "numeric" || field.type === "pct") {
          const hasMin = field.minKey != null && filters[field.minKey] != null && filters[field.minKey] !== "";
          const hasMax = field.maxKey != null && filters[field.maxKey] != null && filters[field.maxKey] !== "";
          if (hasMin || hasMax) filled++;
        } else if (field.type === "categorical") {
          const v = filters[field.key];
          if (v != null && v !== "") filled++;
        } else if (field.type === "text") {
          const v = filters[field.key];
          if (v != null && String(v).trim() !== "") filled++;
        } else if (field.type === "percentile") {
          const hasMin = field.minKey != null && filters[field.minKey] != null && filters[field.minKey] !== "";
          const hasMax = field.maxKey != null && filters[field.maxKey] != null && filters[field.maxKey] !== "";
          if (hasMin || hasMax) filled++;
        } else if (field.type === "pctOperatorRow") {
          const row = newScreenForm.pctOperatorRows?.[field.key];
          const val = (row?.value ?? "").toString().trim();
          if (val !== "") filled++;
        } else if (field.type === "includeExcludeMulti") {
          const row = newScreenForm.includeExcludeRows?.[field.key];
          if (row && row.selected.length > 0) filled++;
        } else if (field.type === "dateRange") {
          const fromVal = filters[field.fromKey];
          const toVal = filters[field.toKey];
          if ((fromVal != null && fromVal !== "") || (toVal != null && toVal !== "")) filled++;
        } else if (field.type === "universeSelect") {
          if (newScreenForm.universe && newScreenForm.universe !== "all") filled++;
        }
      }
      const total = cat.fields.filter((f) => f.type !== "sectionHeading").length;
      return { filled, total };
    },
    [newScreenForm.filters, newScreenForm.pctOperatorRows, newScreenForm.includeExcludeRows, newScreenForm.universe]
  );

  const formatNumberInput = (raw: string | number | undefined, isPct: boolean): string => {
    if (raw === undefined || raw === "") return "";
    if (isPct) return `${Number(raw)}%`;
    const n = typeof raw === "number" ? raw : parseFloat(String(raw).replace(/,/g, ""));
    if (Number.isNaN(n)) return String(raw);
    return n >= 1000 ? n.toLocaleString("en-US", { maximumFractionDigits: 0 }) : String(n);
  };

  const parseNumberInput = (s: string, _isPct: boolean): string | number | undefined => {
    const trimmed = s.replace(/,/g, "").replace(/%/g, "").trim();
    if (!trimmed) return undefined;
    const n = parseFloat(trimmed);
    return Number.isNaN(n) ? undefined : n;
  };

  /** Build effective filters from form state (same logic as saveNewScreener). */
  const buildEffectiveFilters = useCallback(
    (form: typeof newScreenForm): ScreenerFilters => {
      const filters: ScreenerFilters = { ...form.filters };
      const includeExcludeRows = form.includeExcludeRows ?? {};
      for (const [rowKey, row] of Object.entries(includeExcludeRows)) {
        if (row.selected.length === 0) continue;
        const cat = SCREENER_FILTER_CATEGORIES.find((c) => c.fields.some((f) => f.key === rowKey));
        const field = cat?.fields.find((f) => f.key === rowKey);
        if (field?.type !== "includeExcludeMulti") continue;
        const val = row.selected.join(",");
        if (row.mode === "include") filters[field.includeKey] = val;
        else filters[field.excludeKey] = val;
      }
      const pctOperatorRows = form.pctOperatorRows ?? {};
      for (const [rowKey, row] of Object.entries(pctOperatorRows)) {
        const rawVal = row.value.trim();
        if (!rawVal) continue;
        const cat = SCREENER_FILTER_CATEGORIES.find((c) => c.fields.some((f) => f.key === rowKey));
        const field = cat?.fields.find((f) => f.key === rowKey);
        if (field?.type !== "pctOperatorRow") continue;
        const val = parseFloat(rawVal.replace(/,/g, "").replace(/%/g, ""));
        if (Number.isNaN(val)) continue;
        if (row.operator === "gte" || row.operator === "gt") filters[field.minKey] = val;
        else if (row.operator === "lte" || row.operator === "lt") filters[field.maxKey] = val;
        else if (row.operator === "eq") {
          filters[field.minKey] = val;
          filters[field.maxKey] = val;
        }
      }
      return filters;
    },
    []
  );

  const saveNewScreener = useCallback(() => {
    const name = newScreenForm.name.trim();
    if (!name) return;
    const filters = buildEffectiveFilters(newScreenForm);
    let screen: SavedScreen;
    if (editingScreenId) {
      updateScreen(editingScreenId, { name, universe: newScreenForm.universe, filters });
      const updated = loadScreens();
      setScreens(updated);
      screen = updated.find((s) => s.id === editingScreenId) ?? {
        id: editingScreenId,
        name,
        universe: newScreenForm.universe,
        filters,
        createdAt: new Date().toISOString(),
      };
      setSelectedScreenId(screen.id);
    } else {
      screen = addScreen({ name, universe: newScreenForm.universe, filters });
      setScreens(loadScreens());
      setSelectedScreenId(screen.id);
    }
    setShowNewScreenerModal(false);
    setEditingScreenId(null);
    setNewScreenForm({
      name: "",
      universe: "all",
      filters: {},
      pctOperatorRows: {},
      includeExcludeRows: {},
      expandedSections: Object.fromEntries(SCREENER_FILTER_CATEGORIES.map((c) => [c.id, c.defaultCollapsed ?? true])),
    });
    fetchScreenerResults(screen);
  }, [newScreenForm, buildEffectiveFilters, fetchScreenerResults]);

  useEffect(() => {
    if (!showNewScreenerModal) return;
    const abort = new AbortController();
    const timeout = setTimeout(async () => {
      try {
        let symbols: string[] | undefined;
        if (newScreenForm.universe !== "all") {
          const res = await fetch(`/api/index-constituents?index=${encodeURIComponent(newScreenForm.universe)}`);
          if (res.ok) {
            const data = (await res.json()) as string[];
            symbols = Array.isArray(data) ? data.map((s) => String(s).toUpperCase()) : undefined;
          }
        }
        const filters = buildEffectiveFilters(newScreenForm);
        const params = new URLSearchParams();
        params.set("countOnly", "1");
        if (symbols && symbols.length > 0) params.set("symbols", symbols.join(","));
        if (Object.keys(filters).length > 0) params.set("filters", JSON.stringify(filters));
        const res = await fetch(`/api/screener?${params.toString()}`, { signal: abort.signal });
        if (!res.ok) return;
        const data = (await res.json()) as { count?: number };
        if (typeof data.count === "number") setScreenerResultCount(data.count);
      } catch {
        if (!abort.signal.aborted) setScreenerResultCount(null);
      }
    }, 300);
    return () => {
      clearTimeout(timeout);
      abort.abort();
    };
  }, [showNewScreenerModal, newScreenForm, buildEffectiveFilters]);

  const sortedRows = useMemo(() => {
    if (!sortKey) return rows;
    const copy = [...rows];
    copy.sort((a, b) => {
      const aVal = getRowValue(a, sortKey);
      const bVal = getRowValue(b, sortKey);
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      }
      const aStr = String(aVal ?? "");
      const bStr = String(bVal ?? "");
      const cmp = aStr.localeCompare(bStr, undefined, { numeric: true });
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  const scriptColumnSet = useMemo(() => new Set(scriptColumns), [scriptColumns]);
  const tableColumns = useMemo((): TableColumnId[] => {
    if (sidebarTab === "screener" && selectedScreen) {
      if (selectedScreen.type === "script" && scriptColumns.length > 0) {
        return ["ticker", "lastPrice", ...scriptColumns];
      }
      if (selectedScreen.type !== "script") {
        const filterCols = getFilterCriteriaColumns(selectedScreen.filters);
        if (filterCols.length > 0) {
          return ["ticker", "lastPrice", ...filterCols];
        }
      }
    }
    return visibleColumns;
  }, [sidebarTab, selectedScreen?.type, selectedScreen?.filters, scriptColumns, visibleColumns]);

  const handleSort = useCallback((col: TableColumnId) => {
    if (sortKey === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(col);
      setSortDir("asc");
    }
  }, [sortKey]);

  const getColWidth = useCallback(
    (col: TableColumnId): number => {
      const w = columnWidths[col as ColumnId];
      if (w != null) return w;
      if (col === "name" || col === "industry" || col === "sector") return 180;
      if (col === "ticker") return 72;
      return 100;
    },
    [columnWidths]
  );

  const handleResizeStart = useCallback(
    (col: TableColumnId) => (e: React.MouseEvent) => {
      e.preventDefault();
      resizeColRef.current = col;
      resizeStartX.current = e.clientX;
      resizeStartWidth.current = getColWidth(col);
      setResizingCol(col);
    },
    [getColWidth]
  );

  useEffect(() => {
    if (!resizingCol) return;
    const onMove = (e: MouseEvent) => {
      const col = resizeColRef.current;
      if (!col) return;
      const delta = e.clientX - resizeStartX.current;
      const next = Math.max(60, resizeStartWidth.current + delta);
      setColumnWidths((prev) => {
        const nextWidths = { ...prev, [col]: next };
        saveColumnWidths(nextWidths);
        return nextWidths;
      });
    };
    const onUp = () => {
      setResizingCol(null);
      resizeColRef.current = null;
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [resizingCol]);

  const handleAutoSizeColumns = useCallback(() => {
    setColumnWidths({});
    saveColumnWidths({});
  }, []);

  const handleColumnHeaderDragStart = useCallback((index: number) => (e: React.DragEvent) => {
    if (resizeColRef.current !== null) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData("text/plain", String(index));
    e.dataTransfer.effectAllowed = "move";
    setColDragIndex(index);
  }, []);

  const handleColumnHeaderDragOver = useCallback((index: number) => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setColDropIndex(index);
  }, []);

  const handleColumnHeaderDrop = useCallback(
    (toIndex: number) => (e: React.DragEvent) => {
      e.preventDefault();
      const fromIndex = parseInt(e.dataTransfer.getData("text/plain"), 10);
      if (Number.isNaN(fromIndex) || fromIndex === toIndex) {
        setColDragIndex(null);
        setColDropIndex(null);
        return;
      }
      setVisibleColumns((prev) => {
        const next = [...prev];
        const [removed] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, removed);
        saveVisibleColumns(next);
        return next;
      });
      setColDragIndex(null);
      setColDropIndex(null);
    },
    []
  );

  const handleColumnHeaderDragEnd = useCallback(() => {
    setColDragIndex(null);
    setColDropIndex(null);
  }, []);

  // Smooth drag: update height continuously; clamp to [MIN_PANEL_HEIGHT_PX, max]
  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDraggingPanel.current = true;
      dragStartY.current = e.clientY;
      dragStartHeight.current = panelHeightPx;
    },
    [panelHeightPx]
  );

  useEffect(() => {
    if (resizingCol) return;
    const onMove = (e: MouseEvent) => {
      if (!isDraggingPanel.current) return;
      const dy = dragStartY.current - e.clientY; // positive = drag up = increase height
      const maxH = getMaxPanelHeightPx();
      const newHeight = Math.round(
        Math.max(MIN_PANEL_HEIGHT_PX, Math.min(maxH, dragStartHeight.current + dy))
      );
      lastDraggedHeightPx.current = newHeight;
      onHeightChange(newHeight);
    };
    const onUp = () => {
      if (isDraggingPanel.current) {
        savePanelHeightPx(lastDraggedHeightPx.current);
      }
      isDraggingPanel.current = false;
      dragStartY.current = 0;
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [onHeightChange, panelHeightPx, resizingCol]);

  return (
    <div
      ref={panelRef}
      className={`flex flex-col border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden ${isMinimized ? "shrink-0" : "flex-1 min-h-0"}`}
      style={isMinimized ? { height: "32px", minHeight: "32px" } : undefined}
    >
      {/* Drag bar + view mode icons */}
      <div
        className="flex items-center h-8 shrink-0 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 px-2"
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest("button") != null) return;
          handleDragStart(e);
        }}
        role="button"
        tabIndex={0}
        aria-label="Drag to resize watchlist panel"
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (isMinimized) {
              const h = Math.round(getMaxPanelHeightPx() * 0.5);
              onHeightChange(h);
              savePanelHeightPx(h);
            } else {
              onHeightChange(MIN_PANEL_HEIGHT_PX);
              savePanelHeightPx(MIN_PANEL_HEIGHT_PX);
            }
          }
        }}
      >
        <div className="flex-1 flex justify-center items-center gap-1.5 min-w-0 cursor-ns-resize touch-none select-none">
          <svg
            width="20"
            height="12"
            viewBox="0 0 20 12"
            fill="currentColor"
            className="text-zinc-400 dark:text-zinc-500 shrink-0"
            aria-hidden
          >
            {/* 6 columns, 3 dots per column */}
            {[0, 1, 2, 3, 4, 5].map((col) => (
              <g key={col}>
                <rect x={1.5 + col * 3.2} y={1} width="1.5" height="1.5" rx="0.5" />
                <rect x={1.5 + col * 3.2} y={5.25} width="1.5" height="1.5" rx="0.5" />
                <rect x={1.5 + col * 3.2} y={9.5} width="1.5" height="1.5" rx="0.5" />
              </g>
            ))}
          </svg>
          <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
            Watchlists & Screener
          </span>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={() => {
              onHeightChange(MIN_PANEL_HEIGHT_PX);
              savePanelHeightPx(MIN_PANEL_HEIGHT_PX);
            }}
            className={`p-1.5 rounded ${panelHeightPx <= MIN_PANEL_HEIGHT_PX ? "bg-zinc-300 dark:bg-zinc-600 text-zinc-900 dark:text-zinc-100" : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"}`}
            title="Minimize"
            aria-label="Minimize watchlist"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
              <rect x="2" y="14" width="12" height="2" rx="0.5" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => {
              const h = Math.round(getMaxPanelHeightPx() * 0.5);
              onHeightChange(h);
              savePanelHeightPx(h);
            }}
            className={`p-1.5 rounded ${panelHeightPx > MIN_PANEL_HEIGHT_PX && panelHeightPx <= getMaxPanelHeightPx() * 0.55 ? "bg-zinc-300 dark:bg-zinc-600 text-zinc-900 dark:text-zinc-100" : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"}`}
            title="Half height"
            aria-label="Half height"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
              <path d="M2 2h12v12H2V2zm0 0v6h12V2H2zm0 8h12v4H2v-4z" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => {
              const h = Math.round(getMaxPanelHeightPx() * 0.9);
              onHeightChange(h);
              savePanelHeightPx(h);
            }}
            className={`p-1.5 rounded ${panelHeightPx > getMaxPanelHeightPx() * 0.8 ? "bg-zinc-300 dark:bg-zinc-600 text-zinc-900 dark:text-zinc-100" : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"}`}
            title="Full height"
            aria-label="Full height"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
              <rect x="2" y="2" width="12" height="12" rx="1" />
            </svg>
          </button>
        </div>
      </div>

      {!isMinimized && (
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Left sidebar: tabs + watchlists or predefined lists */}
          <aside
            className="shrink-0 border-r border-zinc-200 dark:border-zinc-700 flex flex-col overflow-hidden"
            style={{ width: sidebarWidthPx }}
          >
            <div className="p-2 border-b border-zinc-200 dark:border-zinc-700">
              <div className="flex rounded border border-zinc-200 dark:border-zinc-600 p-0.5 mb-2">
                <button
                  type="button"
                  onClick={() => setSidebarTab("watchlists")}
                  className={`flex-1 py-1 px-1.5 text-xs font-medium rounded ${sidebarTab === "watchlists" ? "bg-zinc-200 dark:bg-zinc-600 text-zinc-900 dark:text-zinc-100" : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
                >
                  Watchlists
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSidebarTab("lists");
                    clearSelection();
                  }}
                  className={`flex-1 py-1 px-1.5 text-xs font-medium rounded ${sidebarTab === "lists" ? "bg-zinc-200 dark:bg-zinc-600 text-zinc-900 dark:text-zinc-100" : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
                >
                  Lists
                </button>
                <button
                  type="button"
                  onClick={() => setSidebarTab("screener")}
                  className={`flex-1 py-1 px-1.5 text-xs font-medium rounded ${sidebarTab === "screener" ? "bg-zinc-200 dark:bg-zinc-600 text-zinc-900 dark:text-zinc-100" : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
                >
                  Screener
                </button>
              </div>
              {sidebarTab === "watchlists" && (
                <button
                  type="button"
                  onClick={addList}
                  className="w-full text-left text-sm text-blue-600 dark:text-blue-400 hover:underline py-1"
                >
                  New List
                </button>
              )}
              {sidebarTab === "screener" && (
                <div className="relative flex items-center" ref={screenerAddMenuRef}>
                  <button
                    type="button"
                    onClick={() => setShowScreenerAddMenu((v) => !v)}
                    className="flex items-center justify-center w-8 h-8 rounded border border-zinc-300 dark:border-zinc-600 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 hover:border-zinc-400 dark:hover:border-zinc-500"
                    title="Add screener, script, or folder"
                    aria-label="Add"
                    aria-expanded={showScreenerAddMenu}
                    aria-haspopup="true"
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                      <path d="M8 3a.5.5 0 0 1 .5.5v4h4a.5.5 0 0 1 0 1h-4v4a.5.5 0 0 1-1 0v-4h-4a.5.5 0 0 1 0-1h4v-4A.5.5 0 0 1 8 3z" />
                    </svg>
                  </button>
                  {showScreenerAddMenu && (
                    <div
                      className="absolute left-0 top-full mt-1 z-50 min-w-[11rem] py-1 rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-800 shadow-lg"
                      role="menu"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setShowScreenerAddMenu(false);
                          openNewScreenerModal();
                        }}
                        className="w-full text-left px-3 py-2 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                      >
                        New Screener
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setShowScreenerAddMenu(false);
                          setEditingScriptScreenId(null);
                          setNewScriptName("");
                          setNewScriptBody("");
                          setShowNewScriptModal(true);
                        }}
                        className="w-full text-left px-3 py-2 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                      >
                        New Script
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setShowScreenerAddMenu(false);
                          setEditingScriptScreenId(null);
                          setNewFolderName("");
                          setShowNewFolderModal(true);
                        }}
                        className="w-full text-left px-3 py-2 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                      >
                        New Folder
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
              {sidebarTab === "screener" ? (
              <ul className="flex-1 overflow-y-auto py-1 flex flex-col gap-0 min-h-0">
                {/* Root drop zone: move screen out of folder */}
                {draggedScreenId && (
                  <li
                    className={`px-3 py-1.5 text-xs rounded border border-dashed transition-colors ${dragOverRoot ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300" : "border-zinc-300 dark:border-zinc-600 text-zinc-500 dark:text-zinc-400"}`}
                    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOverRoot(true); setDragOverFolderId(null); }}
                    onDragLeave={() => setDragOverRoot(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      const id = e.dataTransfer.getData("screenId");
                      if (id) { moveScreenToFolder(id, null); setScreens(loadScreens()); }
                      setDraggedScreenId(null); setDragOverRoot(false);
                    }}
                  >
                    Drop here to move to root
                  </li>
                )}
                {/* Root-level screens */}
                {rootScreens.map((s) => (
                  <li key={s.id} className="flex items-center gap-0 min-w-0 group">
                    <div
                      draggable
                      onDragStart={(e) => { e.dataTransfer.setData("screenId", s.id); e.dataTransfer.effectAllowed = "move"; setDraggedScreenId(s.id); }}
                      onDragEnd={() => { setDraggedScreenId(null); setDragOverFolderId(null); setDragOverRoot(false); }}
                      className={`flex-1 flex items-center gap-0 min-w-0 rounded ${draggedScreenId === s.id ? "opacity-50" : ""}`}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedScreenId(s.id)}
                        className={`flex-1 min-w-0 text-left px-3 py-2 text-sm flex items-center gap-1 rounded-r ${selectedScreenId === s.id ? "border-l-2 border-blue-500 bg-zinc-100 dark:bg-zinc-800/70 font-medium text-zinc-900 dark:text-zinc-100" : "border-l-2 border-transparent text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
                      >
                        {s.type === "script" && <span className="shrink-0 text-amber-600 dark:text-amber-400" title="Script">⌘</span>}
                        <span className="truncate min-w-0">{s.name}</span>
                        {s.type !== "script" && (selectedScreenId === s.id ? screenerResultCount : screenerCounts[s.id]) != null && (
                          <span className="shrink-0 text-zinc-500 dark:text-zinc-400">
                            ({(selectedScreenId === s.id ? screenerResultCount : screenerCounts[s.id])!.toLocaleString()})
                          </span>
                        )}
                      </button>
                      <button type="button" onClick={(e) => { e.stopPropagation(); const screen = screens.find((x) => x.id === s.id); if (!screen) return; setSidebarTab("screener"); if (screen.type === "script") { setEditingScriptScreenId(screen.id); setNewScriptName(screen.name); setNewScriptBody(screen.scriptBody ?? ""); setShowNewScriptModal(true); } else { setEditingScreenId(screen.id); setScreenerModalPosition(null); setNewScreenForm({ name: screen.name, universe: screen.universe, filters: { ...screen.filters }, pctOperatorRows: buildPctOperatorRowsFromFilters(screen.filters), includeExcludeRows: buildIncludeExcludeRowsFromFilters(screen.filters), expandedSections: Object.fromEntries(SCREENER_FILTER_CATEGORIES.map((c) => [c.id, c.defaultCollapsed ?? true])) }); setShowNewScreenerModal(true); } }} className="shrink-0 p-1.5 rounded text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 hover:text-zinc-900 dark:hover:text-zinc-100" title={`Edit ${s.name}`} aria-label={`Edit ${s.name}`}><svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden><path d="M12.146 3.146a.5.5 0 0 1 .708 0l.999.999a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.168.11l-3 1a.5.5 0 0 1-.65-.65l1-3a.5.5 0 0 1 .11-.168l7-7zM11.207 4.5 5 10.707V11h.293L11.5 4.793 11.207 4.5z" /></svg></button>
                      <button type="button" onClick={(e) => { e.stopPropagation(); const screen = screens.find((x) => x.id === s.id); if (screen) openDuplicateScreener(screen); }} className="shrink-0 p-1.5 rounded text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 hover:text-zinc-900 dark:hover:text-zinc-100" title={`Duplicate ${s.name}`} aria-label={`Duplicate ${s.name}`}><svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden><path d="M4 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V2zm2-1a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H6zM2 5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1h1v1a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1v1H2z" /></svg></button>
                      <button type="button" onClick={(e) => { e.stopPropagation(); deleteScreen(s.id); setScreens(loadScreens()); setScreenerCounts((p) => { const n = { ...p }; delete n[s.id]; return n; }); if (selectedScreenId === s.id) { setSelectedScreenId(null); setRows([]); setScreenerResultCount(null); } }} className="shrink-0 p-1.5 rounded text-zinc-500 dark:text-zinc-400 hover:bg-red-100 dark:hover:bg-red-900/40 hover:text-red-600 dark:hover:text-red-400" title={`Delete ${s.name}`} aria-label={`Delete ${s.name}`}><svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden><path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" /></svg></button>
                    </div>
                  </li>
                ))}
                {/* Folders with their screens */}
                {sortedFolders.map((f) => {
                  const folderScreens = screensByFolderId[f.id] ?? [];
                  const isExpanded = expandedFolderIds.has(f.id);
                  const isDropTarget = dragOverFolderId === f.id;
                  return (
                    <li key={f.id} className="min-w-0">
                      <div
                        className={`flex items-center gap-0 min-w-0 rounded mt-0.5 ${isDropTarget ? "ring-1 ring-blue-500 bg-blue-50 dark:bg-blue-900/20" : ""}`}
                        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOverFolderId(f.id); setDragOverRoot(false); }}
                        onDragLeave={() => setDragOverFolderId((cur) => (cur === f.id ? null : cur))}
                        onDrop={(e) => {
                          e.preventDefault();
                          const id = e.dataTransfer.getData("screenId");
                          if (id) { moveScreenToFolder(id, f.id); setScreens(loadScreens()); }
                          setDraggedScreenId(null); setDragOverFolderId(null);
                        }}
                      >
                        <button type="button" onClick={() => toggleFolderExpanded(f.id)} className="shrink-0 p-1 rounded text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label={isExpanded ? "Collapse" : "Expand"}>
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className={`transition-transform ${isExpanded ? "rotate-90" : ""}`}><path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06z" /></svg>
                        </button>
                        <span className="flex-1 min-w-0 truncate px-2 py-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300">{f.name}</span>
                        <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400 pr-1">{folderScreens.length}</span>
                        <button type="button" onClick={(e) => { e.stopPropagation(); deleteFolder(f.id); setFolders(loadFolders()); setScreens(loadScreens()); }} className="shrink-0 p-1 rounded text-zinc-500 dark:text-zinc-400 hover:bg-red-100 dark:hover:bg-red-900/40 hover:text-red-600 dark:hover:text-red-400" title={`Delete folder ${f.name}`} aria-label={`Delete folder ${f.name}`}><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z" /><path fillRule="evenodd" d="M14.5 3a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1V1a1 1 0 0 1 1-1h13a1 1 0 0 1 1 1v2zM2 2v1h12V2H2z" /></svg></button>
                      </div>
                      {isExpanded && (
                        <ul className="pl-4 py-0.5 border-l border-zinc-200 dark:border-zinc-700 ml-2 mt-0.5 space-y-0">
                          {folderScreens.map((s) => (
                            <li key={s.id} className="flex items-center gap-0 min-w-0">
                              <div draggable onDragStart={(e) => { e.dataTransfer.setData("screenId", s.id); e.dataTransfer.effectAllowed = "move"; setDraggedScreenId(s.id); }} onDragEnd={() => { setDraggedScreenId(null); setDragOverFolderId(null); setDragOverRoot(false); }} className={`flex-1 flex items-center gap-0 min-w-0 rounded ${draggedScreenId === s.id ? "opacity-50" : ""}`}>
                                <button type="button" onClick={() => setSelectedScreenId(s.id)} className={`flex-1 min-w-0 text-left px-2 py-1.5 text-sm flex items-center gap-1 rounded-r ${selectedScreenId === s.id ? "border-l-2 border-blue-500 bg-zinc-100 dark:bg-zinc-800/70 font-medium text-zinc-900 dark:text-zinc-100" : "border-l-2 border-transparent text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}>
                                  {s.type === "script" && <span className="shrink-0 text-amber-600 dark:text-amber-400" title="Script">⌘</span>}
                                  <span className="truncate min-w-0">{s.name}</span>
                                  {s.type !== "script" && (selectedScreenId === s.id ? screenerResultCount : screenerCounts[s.id]) != null && <span className="shrink-0 text-zinc-500 dark:text-zinc-400">({(selectedScreenId === s.id ? screenerResultCount : screenerCounts[s.id])!.toLocaleString()})</span>}
                                </button>
                                <button type="button" onClick={(e) => { e.stopPropagation(); const screen = screens.find((x) => x.id === s.id); if (!screen) return; setSidebarTab("screener"); if (screen.type === "script") { setEditingScriptScreenId(screen.id); setNewScriptName(screen.name); setNewScriptBody(screen.scriptBody ?? ""); setShowNewScriptModal(true); } else { setEditingScreenId(screen.id); setScreenerModalPosition(null); setNewScreenForm({ name: screen.name, universe: screen.universe, filters: { ...screen.filters }, pctOperatorRows: buildPctOperatorRowsFromFilters(screen.filters), includeExcludeRows: buildIncludeExcludeRowsFromFilters(screen.filters), expandedSections: Object.fromEntries(SCREENER_FILTER_CATEGORIES.map((c) => [c.id, c.defaultCollapsed ?? true])) }); setShowNewScreenerModal(true); } }} className="shrink-0 p-1 rounded text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700" title={`Edit ${s.name}`} aria-label={`Edit ${s.name}`}><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M12.146 3.146a.5.5 0 0 1 .708 0l.999.999a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.168.11l-3 1a.5.5 0 0 1-.65-.65l1-3a.5.5 0 0 1 .11-.168l7-7zM11.207 4.5 5 10.707V11h.293L11.5 4.793 11.207 4.5z" /></svg></button>
                                <button type="button" onClick={(e) => { e.stopPropagation(); const screen = screens.find((x) => x.id === s.id); if (screen) openDuplicateScreener(screen); }} className="shrink-0 p-1 rounded text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700" title={`Duplicate ${s.name}`} aria-label={`Duplicate ${s.name}`}><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M4 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V2zm2-1a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H6zM2 5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1h1v1a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1v1H2z" /></svg></button>
                                <button type="button" onClick={(e) => { e.stopPropagation(); deleteScreen(s.id); setScreens(loadScreens()); setScreenerCounts((p) => { const n = { ...p }; delete n[s.id]; return n; }); if (selectedScreenId === s.id) { setSelectedScreenId(null); setRows([]); setScreenerResultCount(null); } }} className="shrink-0 p-1 rounded text-zinc-500 dark:text-zinc-400 hover:bg-red-100 dark:hover:bg-red-900/40 hover:text-red-600 dark:hover:text-red-400" title={`Delete ${s.name}`} aria-label={`Delete ${s.name}`}><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" /></svg></button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
                {screens.length === 0 && folders.length === 0 && (
                  <li className="px-3 py-2 text-sm text-zinc-500 dark:text-zinc-400">
                    No screens yet. Use the + button to create a screener, script, or folder.
                  </li>
                )}
              </ul>
            ) : sidebarTab === "watchlists" ? (
              <ul className="flex-1 overflow-y-auto py-1">
                {lists.map((l) => (
                  <li key={l.id} className="flex items-center gap-0 min-w-0">
                    <button
                      type="button"
                      onClick={() => setActiveListId(l.id)}
                      className={`flex-1 min-w-0 text-left px-3 py-2 text-sm flex items-center gap-1 rounded-r ${activeListId === l.id ? "border-l-2 border-blue-500 bg-zinc-100 dark:bg-zinc-800/70 font-medium text-zinc-900 dark:text-zinc-100" : "border-l-2 border-transparent text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
                    >
                      <span className="truncate min-w-0">{l.name}</span>
                      <span className="shrink-0 text-zinc-500 dark:text-zinc-400">({l.symbols.length})</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openAddPopup(l.id);
                      }}
                      className="shrink-0 p-1.5 rounded text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 hover:text-zinc-900 dark:hover:text-zinc-100"
                      title={`Edit ${l.name}`}
                      aria-label={`Edit ${l.name}`}
                    >
                      <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                        <path d="M12.146 3.146a.5.5 0 0 1 .708 0l.999.999a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.168.11l-3 1a.5.5 0 0 1-.65-.65l1-3a.5.5 0 0 1 .11-.168l7-7zM11.207 4.5 5 10.707V11h.293L11.5 4.793 11.207 4.5z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        const nextLists = lists.filter((list) => list.id !== l.id);
                        setLists(nextLists);
                        saveWatchlists(nextLists);
                        if (activeListId === l.id) {
                          setActiveListId(nextLists[0]?.id ?? null);
                          setRows([]);
                        }
                      }}
                      className="shrink-0 p-1.5 rounded text-zinc-500 dark:text-zinc-400 hover:bg-red-100 dark:hover:bg-red-900/40 hover:text-red-600 dark:hover:text-red-400"
                      title={`Delete ${l.name}`}
                      aria-label={`Delete ${l.name}`}
                    >
                      <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                        <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" />
                      </svg>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <ul className="flex-1 overflow-y-auto py-1">
                {relatedStocksList && relatedStocksList.symbols.length > 0 && (
                  <li key={RELATED_LIST_ID}>
                    <button
                      type="button"
                      onClick={() => setSelectedPredefinedListId(RELATED_LIST_ID)}
                      className={`w-full min-w-0 text-left px-3 py-2 text-sm flex items-center gap-1 rounded-r ${selectedPredefinedListId === RELATED_LIST_ID ? "border-l-2 border-blue-500 bg-zinc-100 dark:bg-zinc-800/70 font-medium text-zinc-900 dark:text-zinc-100" : "border-l-2 border-transparent text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
                    >
                      <span className="truncate min-w-0">{relatedStocksList.title}</span>
                      <span className="shrink-0 text-zinc-500 dark:text-zinc-400">({relatedStocksList.symbols.length})</span>
                    </button>
                  </li>
                )}
                {PREDEFINED_LISTS.map((pl) => {
                  const count = predefinedListSymbols[pl.id]?.length;
                  return (
                    <li key={pl.id} className="min-w-0">
                      <button
                        type="button"
                        onClick={() => setSelectedPredefinedListId(pl.id)}
                        className={`w-full min-w-0 text-left px-3 py-2 text-sm flex items-center gap-1 rounded-r ${selectedPredefinedListId === pl.id ? "border-l-2 border-blue-500 bg-zinc-100 dark:bg-zinc-800/70 font-medium text-zinc-900 dark:text-zinc-100" : "border-l-2 border-transparent text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
                      >
                        <span className="truncate min-w-0">{pl.name}</span>
                        <span className="shrink-0 text-zinc-500 dark:text-zinc-400">({count ?? "…"})</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>
          <button
            type="button"
            onMouseDown={startSidebarResize}
            className="shrink-0 w-1.5 flex flex-col justify-center items-center cursor-col-resize border-0 bg-transparent hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors group"
            title="Drag to resize sidebar"
            aria-label="Resize sidebar"
          >
            <span className="w-0.5 h-8 rounded-full bg-zinc-300 dark:bg-zinc-600 group-hover:bg-zinc-500 dark:group-hover:bg-zinc-400 pointer-events-none" />
          </button>

          {/* Edit watchlist popup (add/remove stocks) */}
          {addPopupListId != null && (() => {
            const list = lists.find((l) => l.id === addPopupListId);
            return (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
                onClick={(e) => e.target === e.currentTarget && closeAddPopup()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="add-stocks-title"
              >
                <div
                  className="bg-white dark:bg-zinc-800 rounded-lg shadow-xl border border-zinc-200 dark:border-zinc-700 w-full max-w-md max-h-[80vh] flex flex-col"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center justify-between p-3 border-b border-zinc-200 dark:border-zinc-700 shrink-0">
                    <h2 id="add-stocks-title" className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 uppercase tracking-wide">
                      Edit {list?.name ?? "list"}
                    </h2>
                    <button
                      type="button"
                      onClick={closeAddPopup}
                      className="p-1 rounded text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-400 dark:hover:text-zinc-200"
                      aria-label="Close"
                    >
                      <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                        <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8 2.146 2.854Z" />
                      </svg>
                    </button>
                  </div>
                  <div className="p-3 border-b border-zinc-200 dark:border-zinc-700 shrink-0">
                    <div className="relative">
                      <input
                        ref={popupSearchInputRef}
                        type="text"
                        value={popupSearchQuery}
                        onChange={(e) => setPopupSearchQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            const pick = popupSearchHighlighted >= 0 && popupSearchResults[popupSearchHighlighted]
                              ? popupSearchResults[popupSearchHighlighted]
                              : popupSearchResults[0];
                            if (pick) {
                              addPendingFromSearch(pick.symbol, pick.name);
                            } else if (popupSearchQuery.trim()) {
                              addPendingFromSearch(popupSearchQuery.trim().toUpperCase(), popupSearchQuery.trim());
                            }
                          } else if (e.key === "ArrowDown") {
                            e.preventDefault();
                            setPopupSearchHighlighted((i) => (i < popupSearchResults.length - 1 ? i + 1 : 0));
                          } else if (e.key === "ArrowUp") {
                            e.preventDefault();
                            setPopupSearchHighlighted((i) => (i > 0 ? i - 1 : popupSearchResults.length - 1));
                          } else if (e.key === "Escape") {
                            setPopupSearchResults([]);
                            setPopupSearchHighlighted(-1);
                          }
                        }}
                        placeholder="Type ticker and press Enter..."
                        className="w-full rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
                        autoComplete="off"
                      />
                      {popupSearchResults.length > 0 && (
                        <ul className="absolute left-0 right-0 top-full z-10 mt-1 max-h-48 overflow-auto rounded border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-800 shadow-lg py-1">
                          {popupSearchResults.map((s, i) => (
                            <li key={s.symbol}>
                              <button
                                type="button"
                                className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 ${i === popupSearchHighlighted ? "bg-zinc-100 dark:bg-zinc-700" : "hover:bg-zinc-50 dark:hover:bg-zinc-700/50"}`}
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  addPendingFromSearch(s.symbol, s.name);
                                }}
                              >
                                <span className="font-medium font-mono text-zinc-900 dark:text-zinc-100">{s.symbol}</span>
                                <span className="text-zinc-500 dark:text-zinc-400 truncate">{s.name ?? ""}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                  <div className="flex-1 min-h-0 overflow-auto p-3 space-y-3">
                    <div>
                      <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wide mb-1">
                        Current stocks
                      </h3>
                      {list && list.symbols.length > 0 ? (
                        <ul className="max-h-40 overflow-auto border border-zinc-200 dark:border-zinc-700 rounded">
                          {list.symbols.map((sym) => (
                            <li
                              key={sym}
                              className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm border-b last:border-b-0 border-zinc-200 dark:border-zinc-700"
                            >
                              <span className="font-medium font-mono text-zinc-900 dark:text-zinc-100">{sym}</span>
                              <button
                                type="button"
                                onClick={() =>
                                  setLists((prev) =>
                                    prev.map((l) =>
                                      l.id === list.id
                                        ? { ...l, symbols: l.symbols.filter((s) => s !== sym) }
                                        : l
                                    )
                                  )
                                }
                                className="shrink-0 p-0.5 rounded text-zinc-400 hover:text-red-600 dark:hover:text-red-400"
                                aria-label={`Remove ${sym} from ${list.name}`}
                              >
                                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                                  <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8 2.146 2.854Z" />
                                </svg>
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-zinc-500 dark:text-zinc-400">
                          This list is currently empty.
                        </p>
                      )}
                    </div>
                    <div>
                      <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wide mb-1">
                        Add stocks
                      </h3>
                      {pendingAdds.length === 0 ? (
                        <p className="text-sm text-zinc-500 dark:text-zinc-400">
                          Type a ticker above and press Enter to queue new stocks.
                        </p>
                      ) : (
                        <ul className="space-y-1">
                          {pendingAdds.map((p) => (
                            <li
                              key={p.symbol}
                              className="flex items-center justify-between gap-2 py-1.5 px-2 rounded bg-zinc-50 dark:bg-zinc-700/50 text-sm"
                            >
                              <span className="font-medium font-mono text-zinc-900 dark:text-zinc-100">{p.symbol}</span>
                              <span className="flex-1 min-w-0 truncate text-zinc-600 dark:text-zinc-400">
                                {p.name}
                              </span>
                              <button
                                type="button"
                                onClick={() => removePending(p.symbol)}
                                className="shrink-0 p-0.5 rounded text-zinc-400 hover:text-red-600 dark:hover:text-red-400"
                                aria-label={`Remove ${p.symbol}`}
                              >
                                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                                  <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8 2.146 2.854Z" />
                                </svg>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                  <div className="p-3 border-t border-zinc-200 dark:border-zinc-700 shrink-0 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={closeAddPopup}
                      className="px-3 py-1.5 text-sm rounded border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={commitPendingToWatchlist}
                      disabled={pendingAdds.length === 0}
                      className="px-3 py-1.5 text-sm rounded bg-zinc-800 dark:bg-zinc-600 text-white hover:bg-zinc-700 dark:hover:bg-zinc-500 disabled:opacity-50 disabled:pointer-events-none"
                    >
                      Add {pendingAdds.length > 0 ? `${pendingAdds.length} stock${pendingAdds.length === 1 ? "" : "s"} to list` : "Add to list"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* New Folder modal */}
          {showNewFolderModal && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
              onClick={(e) => e.target === e.currentTarget && setShowNewFolderModal(false)}
              role="dialog"
              aria-modal="true"
              aria-labelledby="new-folder-title"
            >
              <div
                className="bg-white dark:bg-zinc-800 rounded-lg shadow-xl border border-zinc-200 dark:border-zinc-700 w-full max-w-sm flex flex-col p-4"
                onClick={(e) => e.stopPropagation()}
              >
                <h2 id="new-folder-title" className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 uppercase tracking-wide mb-3">
                  New Folder
                </h2>
                <input
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="Folder name"
                  className="w-full rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-2 py-1.5 text-sm text-zinc-800 dark:text-zinc-300 placeholder:text-zinc-500 dark:placeholder:text-zinc-500 mb-4"
                  onKeyDown={(e) => e.key === "Enter" && (addFolder({ name: newFolderName.trim() || "New folder" }), setFolders(loadFolders()), setShowNewFolderModal(false), setNewFolderName(""))}
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => (setShowNewFolderModal(false), setNewFolderName(""))}
                    className="px-3 py-1.5 text-sm rounded border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      addFolder({ name: newFolderName.trim() || "New folder" });
                      setFolders(loadFolders());
                      setShowNewFolderModal(false);
                      setNewFolderName("");
                    }}
                    className="px-3 py-1.5 text-sm rounded bg-zinc-800 dark:bg-zinc-600 text-white hover:bg-zinc-700 dark:hover:bg-zinc-500"
                  >
                    Create
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* New Script modal */}
          {showNewScriptModal && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
              onClick={(e) => e.target === e.currentTarget && (setShowNewScriptModal(false), setEditingScriptScreenId(null))}
              role="dialog"
              aria-modal="true"
              aria-labelledby="new-script-title"
            >
              <div
                className="bg-white dark:bg-zinc-800 rounded-lg shadow-xl border border-zinc-200 dark:border-zinc-700 w-full max-w-2xl max-h-[85vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="p-3 border-b border-zinc-200 dark:border-zinc-700 shrink-0 flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <h2 id="new-script-title" className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 uppercase tracking-wide mb-3">
                      {editingScriptScreenId ? "Edit Script" : "New Script"}
                    </h2>
                    <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Custom Screener Name</label>
                    <input
                      type="text"
                      value={newScriptName}
                      onChange={(e) => setNewScriptName(e.target.value)}
                      placeholder="e.g. My custom scan"
                      className="w-full rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-2 py-1.5 text-sm text-zinc-800 dark:text-zinc-300 placeholder:text-zinc-500 dark:placeholder:text-zinc-500"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowNinoScriptHelp(true)}
                    className="shrink-0 p-2 rounded-full border border-zinc-300 dark:border-zinc-600 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 hover:text-zinc-900 dark:hover:text-zinc-200"
                    title="Nino Script help"
                    aria-label="Open Nino Script help"
                  >
                    <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                      <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z" />
                      <path d="M5.255 5.786a.237.237 0 0 0 .241.247h.825c.138 0 .248-.113.266-.25.09-.656.54-1.134 1.342-1.134.686 0 1.314.343 1.314 1.168 0 .635-.374.927-.965 1.371-.673.489-1.206 1.06-1.168 1.987l.003.217a.25.25 0 0 0 .25.246h.811a.25.25 0 0 0 .25-.25v-.105c0-.718.273-.927 1.01-1.486.609-.463 1.244-.977 1.244-2.056 0-1.511-1.276-2.241-2.673-2.241-1.267 0-2.655.59-2.75 2.286zm1.557 5.763c0 .533.425.927 1.01.927.609 0 1.028-.394 1.028-.927 0-.552-.42-.93-1.029-.93-.584 0-1.009.378-1.009.93z" />
                    </svg>
                  </button>
                </div>
                <div className="flex-1 min-h-0 flex flex-col p-3">
                  <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Script</label>
                  <NinoScriptEditor
                    value={newScriptBody}
                    onChange={setNewScriptBody}
                    placeholder="e.g. P > 10 and MA(C, 50) > 500000"
                    minHeight="200px"
                  />
                </div>
                {showNinoScriptHelp && (
                  <NinoScriptHelp onClose={() => setShowNinoScriptHelp(false)} />
                )}
                <div className="flex justify-end gap-2 p-3 border-t border-zinc-200 dark:border-zinc-700 shrink-0">
                  <button
                    type="button"
                    onClick={() => (setShowNewScriptModal(false), setNewScriptName(""), setNewScriptBody(""), setEditingScriptScreenId(null))}
                    className="px-3 py-1.5 text-sm rounded border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const name = newScriptName.trim() || "Unnamed script";
                      if (editingScriptScreenId) {
                        updateScreen(editingScriptScreenId, { name, scriptBody: newScriptBody });
                      } else {
                        addScreen({
                          name,
                          universe: "all",
                          filters: {},
                          type: "script",
                          scriptBody: newScriptBody,
                        });
                      }
                      setScreens(loadScreens());
                      setShowNewScriptModal(false);
                      setNewScriptName("");
                      setNewScriptBody("");
                      setEditingScriptScreenId(null);
                    }}
                    className="px-3 py-1.5 text-sm rounded bg-zinc-800 dark:bg-zinc-600 text-white hover:bg-zinc-700 dark:hover:bg-zinc-500"
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* New Screener modal */}
          {showNewScreenerModal && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
              onClick={(e) => e.target === e.currentTarget && setShowNewScreenerModal(false)}
              role="dialog"
              aria-modal="true"
              aria-labelledby="new-screener-title"
            >
              <div
                ref={screenerModalRef}
                className="bg-white dark:bg-zinc-800 rounded-lg shadow-xl border border-zinc-200 dark:border-zinc-700 w-full max-w-4xl max-h-[90vh] flex flex-col"
                style={
                  screenerModalPosition
                    ? { position: "fixed", left: screenerModalPosition.x, top: screenerModalPosition.y }
                    : undefined
                }
                onClick={(e) => e.stopPropagation()}
              >
                <div
                  className="flex items-center justify-between p-3 border-b border-zinc-200 dark:border-zinc-700 shrink-0 cursor-grab active:cursor-grabbing select-none"
                  onMouseDown={startScreenerModalDrag}
                  role="presentation"
                >
                  <h2 id="new-screener-title" className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 uppercase tracking-wide">
                    {editingScreenId ? "Edit Screener" : "New Screener"}
                  </h2>
                  <button
                    type="button"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => setShowNewScreenerModal(false)}
                    className="p-1 rounded text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-400 dark:hover:text-zinc-200 shrink-0"
                    aria-label="Close"
                  >
                    <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                      <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8 2.146 2.854Z" />
                    </svg>
                  </button>
                </div>
                <div className="flex-1 min-h-0 overflow-auto p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400 w-36 shrink-0">Screen Name</label>
                    <input
                      type="text"
                      value={newScreenForm.name}
                      onChange={(e) => setNewScreenForm((p) => ({ ...p, name: e.target.value }))}
                      placeholder="e.g. Large Cap Growth"
                      className="flex-1 min-w-0 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-2 py-1 text-sm font-normal text-zinc-800 dark:text-zinc-300 placeholder:text-zinc-500 dark:placeholder:text-zinc-500"
                    />
                  </div>
                  <div className="flex gap-4">
                    {/* Left column: section labels */}
                    <div className="w-48 shrink-0 flex flex-col gap-0.5 border border-zinc-200 dark:border-zinc-600 rounded-lg overflow-hidden">
                      {SCREENER_FILTER_CATEGORIES.map((cat) => {
                        const { filled, total } = getCategoryCounts(cat);
                        const isSelected = selectedScreenerSectionId === cat.id;
                        return (
                          <button
                            key={cat.id}
                            type="button"
                            onClick={() => setSelectedScreenerSectionId(cat.id)}
                            className={`w-full flex items-center justify-between px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide transition-colors ${
                              isSelected
                                ? "bg-zinc-800 dark:bg-zinc-600 text-white"
                                : "bg-zinc-100 dark:bg-zinc-800/80 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700/80"
                            }`}
                          >
                            <span>{cat.title}</span>
                            <span className={`shrink-0 text-sm tabular-nums ${isSelected ? "text-zinc-300 dark:text-zinc-200" : "text-zinc-500 dark:text-zinc-400"}`}>
                              {filled}/{total}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    {/* Right column: variables for selected section - fixed height, scroll when needed */}
                    <div className="flex-1 min-w-0 h-[460px] overflow-y-auto overflow-x-hidden border border-zinc-200 dark:border-zinc-600 rounded-lg p-3 space-y-1.5">
                      {selectedScreenerSectionId &&
                        SCREENER_FILTER_CATEGORIES.find((c) => c.id === selectedScreenerSectionId)?.fields?.map((field) => {
                              if (field.type === "numeric" || field.type === "pct") {
                                const isPct = field.type === "pct";
                                return (
                                  <div key={field.key} className="flex items-center gap-2">
                                    <span className="text-xs text-zinc-500 dark:text-zinc-400 w-36 shrink-0">{field.label}</span>
                                    <div className="flex gap-2 flex-1 min-w-0">
                                      {field.minKey != null && (
                                        <input
                                          type="text"
                                          value={
                                            field.type === "numeric" && field.format === "number"
                                              ? formatNumberInput(newScreenForm.filters[field.minKey], false)
                                              : isPct && newScreenForm.filters[field.minKey] != null && newScreenForm.filters[field.minKey] !== ""
                                                ? formatNumberInput(newScreenForm.filters[field.minKey], true)
                                                : String(newScreenForm.filters[field.minKey] ?? "")
                                          }
                                          onChange={(e) => {
                                            const v = field.type === "numeric" ? parseNumberInput(e.target.value, false) : (isPct ? parseNumberInput(e.target.value, true) : (e.target.value.trim() ? e.target.value : undefined));
                                            setNewScreenFilter(field.minKey!, v);
                                          }}
                                          placeholder={isPct ? "Min %" : "Min"}
                                          className="flex-1 min-w-0 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-2 py-1 text-sm font-normal text-zinc-800 dark:text-zinc-300 placeholder:text-zinc-500 dark:placeholder:text-zinc-500"
                                        />
                                      )}
                                      {field.maxKey != null && (
                                        <input
                                          type="text"
                                          value={
                                            field.type === "numeric" && field.format === "number"
                                              ? formatNumberInput(newScreenForm.filters[field.maxKey], false)
                                              : isPct && newScreenForm.filters[field.maxKey] != null && newScreenForm.filters[field.maxKey] !== ""
                                                ? formatNumberInput(newScreenForm.filters[field.maxKey], true)
                                                : String(newScreenForm.filters[field.maxKey] ?? "")
                                          }
                                          onChange={(e) => {
                                            const v = field.type === "numeric" ? parseNumberInput(e.target.value, false) : (isPct ? parseNumberInput(e.target.value, true) : (e.target.value.trim() ? e.target.value : undefined));
                                            setNewScreenFilter(field.maxKey!, v);
                                          }}
                                          placeholder={isPct ? "Max %" : "Max"}
                                          className="flex-1 min-w-0 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-2 py-1 text-sm font-normal text-zinc-800 dark:text-zinc-300 placeholder:text-zinc-500 dark:placeholder:text-zinc-500"
                                        />
                                      )}
                                    </div>
                                  </div>
                                );
                              }
                              if (field.type === "pctOperatorRow") {
                                const row = newScreenForm.pctOperatorRows?.[field.key] ?? { operator: "lte", value: "" };
                                return (
                                  <div key={field.key} className="flex items-center gap-2">
                                    <span className="text-xs text-zinc-500 dark:text-zinc-400 w-36 shrink-0">{field.label}</span>
                                    <div className="flex items-center gap-1.5 flex-1 min-w-0">
                                      <select
                                        value={row.operator}
                                        onChange={(e) => setPctOperatorRow(field.key, e.target.value, row.value)}
                                        className="rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-2 py-1 text-sm font-normal text-zinc-800 dark:text-zinc-300 min-w-[9rem]"
                                      >
                                        {PCT_OPERATORS.map((o) => (
                                          <option key={o.value} value={o.value}>{o.label}</option>
                                        ))}
                                      </select>
                                      <input
                                        type="text"
                                        value={row.value}
                                        onChange={(e) => setPctOperatorRow(field.key, row.operator, e.target.value.replace(/%/g, "").replace(/,/g, ""))}
                                        placeholder="0"
                                        className="w-16 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-2 py-1 text-sm font-normal text-zinc-800 dark:text-zinc-300 text-right placeholder:text-zinc-500 dark:placeholder:text-zinc-500"
                                      />
                                      <span className="text-xs text-zinc-500 dark:text-zinc-400">%</span>
                                    </div>
                                  </div>
                                );
                              }
                              if (field.type === "percentile") {
                                return (
                                  <div key={field.key} className="flex items-center gap-2">
                                    <span className="text-xs text-zinc-500 dark:text-zinc-400 w-36 shrink-0">{field.label}</span>
                                    <div className="flex gap-2 flex-1 min-w-0">
                                      {field.minKey != null && (
                                        <input
                                          type="text"
                                          value={String(newScreenForm.filters[field.minKey] ?? "")}
                                          onChange={(e) => {
                                            const v = parseNumberInput(e.target.value, false);
                                            setNewScreenFilter(field.minKey!, v);
                                          }}
                                          placeholder="Min (0-100)"
                                          className="flex-1 min-w-0 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-2 py-1 text-sm font-normal text-zinc-800 dark:text-zinc-300 placeholder:text-zinc-500 dark:placeholder:text-zinc-500"
                                        />
                                      )}
                                      {field.maxKey != null && (
                                        <input
                                          type="text"
                                          value={String(newScreenForm.filters[field.maxKey] ?? "")}
                                          onChange={(e) => {
                                            const v = parseNumberInput(e.target.value, false);
                                            setNewScreenFilter(field.maxKey!, v);
                                          }}
                                          placeholder="Max (0-100)"
                                          className="flex-1 min-w-0 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-2 py-1 text-sm font-normal text-zinc-800 dark:text-zinc-300 placeholder:text-zinc-500 dark:placeholder:text-zinc-500"
                                        />
                                      )}
                                    </div>
                                  </div>
                                );
                              }
                              if (field.type === "categorical") {
                                return (
                                  <div key={field.key} className="flex items-center gap-2">
                                    <label className="text-xs text-zinc-500 dark:text-zinc-400 w-36 shrink-0">{field.label}</label>
                                    <select
                                      value={String(newScreenForm.filters[field.key] ?? "")}
                                      onChange={(e) => setNewScreenFilter(field.key, e.target.value || undefined)}
                                      className="flex-1 min-w-0 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-2 py-1 text-sm font-normal text-zinc-800 dark:text-zinc-300 max-w-xs"
                                    >
                                      {field.options.map((opt) => (
                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                      ))}
                                    </select>
                                  </div>
                                );
                              }
                              if (field.type === "text") {
                                return (
                                  <div key={field.key} className="flex items-center gap-2">
                                    <label className="text-xs text-zinc-500 dark:text-zinc-400 w-36 shrink-0">{field.label}</label>
                                    <input
                                      type="text"
                                      value={String(newScreenForm.filters[field.key] ?? "")}
                                      onChange={(e) => setNewScreenFilter(field.key, e.target.value.trim() || undefined)}
                                      placeholder={field.placeholder}
                                      className="flex-1 min-w-0 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-2 py-1 text-sm font-normal text-zinc-800 dark:text-zinc-300 placeholder:text-zinc-500 dark:placeholder:text-zinc-500 max-w-xs"
                                    />
                                  </div>
                                );
                              }
                              if (field.type === "sectionHeading") {
                                return (
                                  <div key={field.key} className="pt-2 mt-2 border-t border-zinc-200 dark:border-zinc-600 first:pt-0 first:mt-0 first:border-t-0">
                                    <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wide">{field.label}</div>
                                  </div>
                                );
                              }
                              if (field.type === "dateRange") {
                                return (
                                  <div key={field.key} className="flex items-center gap-2">
                                    <span className="text-xs text-zinc-500 dark:text-zinc-400 w-36 shrink-0">{field.label}</span>
                                    <div className="flex gap-2 flex-1 min-w-0">
                                      <input
                                        type="date"
                                        value={String(newScreenForm.filters[field.fromKey] ?? "")}
                                        onChange={(e) => setNewScreenFilter(field.fromKey, e.target.value || undefined)}
                                        className="flex-1 min-w-0 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-2 py-1 text-sm font-normal text-zinc-800 dark:text-zinc-300"
                                      />
                                      <span className="text-xs text-zinc-500 dark:text-zinc-400 shrink-0">to</span>
                                      <input
                                        type="date"
                                        value={String(newScreenForm.filters[field.toKey] ?? "")}
                                        onChange={(e) => setNewScreenFilter(field.toKey, e.target.value || undefined)}
                                        className="flex-1 min-w-0 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-2 py-1 text-sm font-normal text-zinc-800 dark:text-zinc-300"
                                      />
                                    </div>
                                  </div>
                                );
                              }
                              if (field.type === "universeSelect") {
                                return (
                                  <div key={field.key} className="flex items-center gap-2">
                                    <label className="text-xs text-zinc-500 dark:text-zinc-400 w-36 shrink-0">{field.label}</label>
                                    <select
                                      value={newScreenForm.universe}
                                      onChange={(e) => setNewScreenForm((p) => ({ ...p, universe: e.target.value }))}
                                      className="flex-1 min-w-0 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-2 py-1 text-sm font-normal text-zinc-800 dark:text-zinc-300 max-w-xs"
                                    >
                                      {UNIVERSE_OPTIONS.map((u) => (
                                        <option key={u.id} value={u.id}>{u.name}</option>
                                      ))}
                                    </select>
                                  </div>
                                );
                              }
                              if (field.type === "includeExcludeMulti") {
                                const row = newScreenForm.includeExcludeRows?.[field.key] ?? { mode: "include" as const, selected: [] };
                                const toggleOption = (value: string) => {
                                  const next = row.selected.includes(value)
                                    ? row.selected.filter((s) => s !== value)
                                    : [...row.selected, value];
                                  setIncludeExcludeRow(field.key, row.mode, next);
                                };
                                return (
                                  <div key={field.key} className="space-y-1.5">
                                    <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{field.label}</div>
                                    <div className="flex items-center gap-4">
                                      <label className="flex items-center gap-1.5 cursor-pointer">
                                        <input
                                          type="radio"
                                          name={`${field.key}-mode`}
                                          checked={row.mode === "include"}
                                          onChange={() => setIncludeExcludeRow(field.key, "include", row.selected)}
                                          className="rounded border-zinc-400 dark:border-zinc-500 text-zinc-800 dark:text-zinc-600"
                                        />
                                        <span className="text-xs font-normal text-zinc-700 dark:text-zinc-300">Include</span>
                                      </label>
                                      <label className="flex items-center gap-1.5 cursor-pointer">
                                        <input
                                          type="radio"
                                          name={`${field.key}-mode`}
                                          checked={row.mode === "exclude"}
                                          onChange={() => setIncludeExcludeRow(field.key, "exclude", row.selected)}
                                          className="rounded border-zinc-400 dark:border-zinc-500 text-zinc-800 dark:text-zinc-600"
                                        />
                                        <span className="text-xs font-normal text-zinc-700 dark:text-zinc-300">Exclude</span>
                                      </label>
                                    </div>
                                    <div className="max-h-32 overflow-y-auto rounded border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-900 p-2 space-y-1">
                                      {field.options.map((opt) => (
                                        <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                                          <input
                                            type="checkbox"
                                            checked={row.selected.includes(opt.value)}
                                            onChange={() => toggleOption(opt.value)}
                                            className="rounded border-zinc-400 dark:border-zinc-500 text-zinc-800 dark:text-zinc-600"
                                          />
                                          <span className="text-xs font-normal text-zinc-700 dark:text-zinc-300">{opt.label}</span>
                                        </label>
                                      ))}
                                    </div>
                                  </div>
                                );
                              }
                              return null;
                            })}
                    </div>
                  </div>
                </div>
                <div className="p-3 border-t border-zinc-200 dark:border-zinc-700 shrink-0 flex justify-between items-center gap-2">
                  <span className="text-sm text-zinc-600 dark:text-zinc-400">
                    Screen Results: {screenerResultCount != null ? screenerResultCount.toLocaleString() : "…"}
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setShowNewScreenerModal(false)}
                      className="px-3 py-1.5 text-sm rounded border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={saveNewScreener}
                      disabled={!newScreenForm.name.trim()}
                      className="px-3 py-1.5 text-sm rounded bg-zinc-800 dark:bg-zinc-600 text-white hover:bg-zinc-700 dark:hover:bg-zinc-500 disabled:opacity-50 disabled:pointer-events-none"
                    >
                      Save & Run
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Right: table */}
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between gap-2 p-2 border-b border-zinc-200 dark:border-zinc-700 shrink-0">
              <div className="min-w-0">
                <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 uppercase truncate">
                  {tableSource.title}
                </h3>
                {tableSource.fromScreener && screenerDbDate && (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                    As of {formatDisplayDate(screenerDbDate)}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowColumnPicker(true)}
                  className="p-1.5 rounded border border-zinc-300 dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 text-xs font-medium"
                  title="Customize columns"
                  aria-label="Customize columns"
                >
                  Columns
                </button>
                <button
                  type="button"
                  onClick={handleAutoSizeColumns}
                  className="p-1.5 rounded border border-zinc-300 dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 text-xs font-medium"
                  title="Auto-size columns to default widths"
                  aria-label="Auto-size columns"
                >
                  Auto-size
                </button>
                <button
                  type="button"
                  onClick={() => fetchRows()}
                  disabled={loading}
                  className="p-1.5 rounded border border-zinc-300 dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
                  title="Refresh"
                  aria-label="Refresh"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className={loading ? "animate-spin" : ""}>
                    <path d="M8 3a5 5 0 1 0 4.547 2.909A.5.5 0 0 1 13 6.5a6 6 0 1 1-5.5-5.96.5.5 0 0 1 .5.5v2a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h1.14A5 5 0 0 0 8 3z" />
                  </svg>
                </button>
                <span className="text-xs text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                  {lastRefresh ? formatDisplayDateTime(lastRefresh) : "NA"}
                </span>
              </div>
            </div>

            {sidebarTab === "watchlists" && selectedSymbols.size > 0 && (
              <div className="relative flex items-center gap-2 px-2 py-1.5 bg-zinc-100 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700 shrink-0" ref={addToListMenuRef}>
                <span className="text-sm text-zinc-600 dark:text-zinc-400">
                  {selectedSymbols.size} selected
                </span>
                <button
                  type="button"
                  onClick={() => removeSymbolsFromList(Array.from(selectedSymbols))}
                  className="text-sm text-red-600 dark:text-red-400 hover:underline"
                >
                  Remove from list
                </button>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowAddToListMenu((v) => !v)}
                    className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    Add to list…
                  </button>
                  {showAddToListMenu && (
                    <ul className="absolute left-0 top-full z-50 mt-1 rounded border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-800 shadow-lg py-1 max-h-40 overflow-auto min-w-32">
                      {lists
                        .filter((l) => l.id !== activeListId)
                        .map((l) => (
                          <li key={l.id}>
                            <button
                              type="button"
                              className="w-full text-left px-3 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700"
                              onClick={() => {
                                Array.from(selectedSymbols).forEach((sym) =>
                                  addSymbolToList(sym, l.id)
                                );
                                clearSelection();
                              }}
                            >
                              {l.name}
                            </button>
                          </li>
                        ))}
                      {lists.filter((l) => l.id !== activeListId).length === 0 && (
                        <li className="px-3 py-2 text-sm text-zinc-500 dark:text-zinc-400">
                          No other lists
                        </li>
                      )}
                    </ul>
                  )}
                </div>
                <button
                  type="button"
                  onClick={clearSelection}
                  className="text-sm text-zinc-500 dark:text-zinc-400 hover:underline"
                >
                  Clear
                </button>
              </div>
            )}

            <div className="flex-1 overflow-x-auto overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-sm">
              <table className="w-full border-collapse text-sm whitespace-nowrap" style={{ minWidth: "max-content" }}>
                <thead className="sticky top-0 bg-zinc-100 dark:bg-zinc-800/98 border-b border-zinc-200 dark:border-zinc-700 z-10 shadow-sm">
                  <tr>
                    <th className="w-10 min-w-[2.5rem] py-1.5 pl-2 pr-1 border-b border-zinc-200 dark:border-zinc-700 align-middle">
                      <div className="flex items-center justify-start">
                        <input
                          type="checkbox"
                          checked={rows.length > 0 && selectedSymbols.size === rows.length}
                          onChange={(e) =>
                            e.target.checked ? selectAll() : clearSelection()
                          }
                          className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-600"
                          aria-label="Select all"
                        />
                      </div>
                    </th>
                    <th className="w-9 min-w-[2.25rem] py-1.5 px-1 border-b border-zinc-200 dark:border-zinc-700 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400">
                      Flag
                    </th>
                    {tableColumns.map((col, colIndex) => {
                      const isScriptCol = scriptColumnSet.has(col as string);
                      const isNumericCol = NUMERIC_COLUMN_IDS.has(col as ColumnId) || isScriptCol;
                      return (
                        <th
                          key={col}
                          draggable={!isScriptCol}
                          onDragStart={!isScriptCol ? handleColumnHeaderDragStart(colIndex) : undefined}
                          onDragOver={!isScriptCol ? handleColumnHeaderDragOver(colIndex) : undefined}
                          onDragLeave={!isScriptCol ? () => setColDropIndex(null) : undefined}
                          onDrop={!isScriptCol ? handleColumnHeaderDrop(colIndex) : undefined}
                          onDragEnd={handleColumnHeaderDragEnd}
                          className={`py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-700 font-medium text-zinc-600 dark:text-zinc-400 whitespace-nowrap ${isNumericCol ? "text-right" : "text-left"} ${colDragIndex === colIndex ? "opacity-50" : ""} ${colDropIndex === colIndex ? "ring-1 ring-blue-500 bg-blue-50/50 dark:bg-blue-900/20" : ""}`}
                          style={{ width: getColWidth(col), minWidth: 60 }}
                        >
                          <div className={`flex items-center gap-0.5 ${isNumericCol ? "justify-end" : ""} ${!isScriptCol ? "cursor-grab active:cursor-grabbing" : ""}`}>
                            <button
                              type="button"
                              onClick={() => handleSort(col)}
                              className="flex items-center gap-0.5 min-w-0 rounded px-0.5 py-0.5 hover:bg-zinc-200 dark:hover:bg-zinc-600 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
                              title={sortKey === col ? (sortDir === "asc" ? "Sort descending" : "Sort ascending") : `Sort by ${getColumnLabel(col)}`}
                              aria-label={sortKey === col ? `Sorted ${sortDir === "asc" ? "ascending" : "descending"} — click to toggle` : `Sort by ${getColumnLabel(col)}`}
                            >
                              <span className="shrink-0">{getColumnLabel(col)}</span>
                              {sortKey === col ? (
                                sortDir === "asc" ? (
                                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="shrink-0 block" aria-hidden>
                                    <path d="M7 14l5-5 5 5H7z" />
                                  </svg>
                                ) : (
                                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="shrink-0 block" aria-hidden>
                                    <path d="M7 10l5 5 5-5H7z" />
                                  </svg>
                                )
                              ) : null}
                            </button>
                            {!isScriptCol && (
                              <span
                                className="cursor-col-resize w-1.5 flex-shrink-0 hover:bg-blue-400/30 rounded"
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  handleResizeStart(col)(e);
                                }}
                                role="separator"
                                aria-label={`Resize ${getColumnLabel(col)}`}
                              />
                            )}
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {loading && rows.length === 0 ? (
                    <tr>
                      <td colSpan={tableColumns.length + 2} className="py-4 text-center text-zinc-500 dark:text-zinc-400">
                        Loading…
                      </td>
                    </tr>
                  ) : sortedRows.length === 0 ? (
                    <tr>
                      <td colSpan={tableColumns.length + 2} className="py-4 text-center text-zinc-500 dark:text-zinc-400">
                        {sidebarTab === "lists" &&
                        selectedPredefinedListId != null &&
                        PREDEFINED_LISTS.some((p) => p.id === selectedPredefinedListId) &&
                        predefinedListSymbolsLoading
                          ? "Loading constituents…"
                          : sidebarTab === "screener" && !selectedScreenId
                            ? "Select a screen or create a new screener."
                            : sidebarTab === "screener" && selectedScreen?.type === "script" && screenerError
                              ? `Script error: ${screenerError}`
                              : sidebarTab === "screener" && selectedScreen?.type === "script" && sortedRows.length === 0 && !loading
                                ? "No results match your script."
                                : sidebarTab === "screener" && sortedRows.length === 0 && !loading
                                  ? "No screener data or no results match. Run npm run refresh-daily to populate the database."
                                  : sidebarTab === "lists" && tableSource.symbols.length === 0
                                ? "Select a predefined list from the sidebar."
                                : "No stocks. Add from search in the left panel."}
                      </td>
                    </tr>
                  ) : (
                    sortedRows.map((row) => {
                      const flag = flags[row.symbol] ?? null;
                      const pickerOpen = flagPickerSymbol === row.symbol;
                      return (
                        <tr
                          key={row.symbol}
                          className={`border-b border-zinc-100 dark:border-zinc-800/80 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 ${selectedSymbols.has(row.symbol) ? "bg-blue-50/80 dark:bg-blue-900/20" : ""}`}
                        >
                          <td className="w-10 min-w-[2.5rem] py-1.5 pl-2 pr-1 align-middle">
                            <div className="flex items-center justify-start">
                              <input
                                type="checkbox"
                                checked={selectedSymbols.has(row.symbol)}
                                onChange={() => toggleSelect(row.symbol)}
                                className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-600"
                                aria-label={`Select ${row.symbol}`}
                              />
                            </div>
                          </td>
                          <td className="py-1.5 px-1 align-middle w-9" data-flag-picker>
                            <div className="relative inline-block">
                              <button
                                type="button"
                                onClick={() => setFlagPickerSymbol(pickerOpen ? null : row.symbol)}
                                className="p-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700"
                                title="Set flag"
                                aria-label={`Flag ${row.symbol}`}
                              >
                                {flag === null ? (
                                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-400 dark:text-zinc-500">
                                    <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
                                    <line x1="4" y1="22" x2="4" y2="15" />
                                  </svg>
                                ) : (
                                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className={
                                    flag === "red" ? "text-red-500" : flag === "yellow" ? "text-yellow-500" : "text-green-500"
                                  }>
                                    <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
                                    <line x1="4" y1="22" x2="4" y2="15" stroke="currentColor" strokeWidth="1.5" />
                                  </svg>
                                )}
                              </button>
                              {pickerOpen && (
                                <div className="absolute left-0 top-full z-20 mt-0.5 flex gap-0.5 p-1 rounded border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-800 shadow-lg">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setFlag(row.symbol, null);
                                      setFlagPickerSymbol(null);
                                    }}
                                    className={`w-5 h-5 rounded border-2 border-zinc-400 dark:border-zinc-500 bg-white dark:bg-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-600 ${flag === null ? "ring-2 ring-offset-1 ring-zinc-500" : ""}`}
                                    title="No flag"
                                    aria-label={`Remove flag from ${row.symbol}`}
                                  />
                                  {(["red", "yellow", "green"] as const).map((c) => (
                                    <button
                                      key={c}
                                      type="button"
                                      onClick={() => {
                                        setFlag(row.symbol, flag === c ? null : c);
                                        setFlagPickerSymbol(null);
                                      }}
                                      className={`w-5 h-5 rounded border-2 ${c === "red" ? "bg-red-500 border-red-600" : c === "yellow" ? "bg-yellow-500 border-yellow-600" : "bg-green-500 border-green-600"} hover:opacity-90`}
                                      title={`Flag ${c}`}
                                      aria-label={`Flag ${row.symbol} ${c}`}
                                    />
                                  ))}
                                </div>
                              )}
                            </div>
                          </td>
                          {tableColumns.map((col) => {
                            const isScriptCol = scriptColumnSet.has(col as string);
                            const isNumeric = NUMERIC_COLUMN_IDS.has(col as ColumnId) || isScriptCol;
                            const isChangePct = col === "changePct";
                            const numVal = isNumeric ? (getRowValue(row, col) as number | undefined) : null;
                            const cellClass =
                              col === "ticker"
                                ? "py-1.5 px-2 font-medium font-mono text-zinc-900 dark:text-zinc-100"
                                : isChangePct && numVal != null
                                  ? `py-1.5 px-2 tabular-nums text-right ${numVal >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`
                                  : isNumeric
                                    ? "py-1.5 px-2 tabular-nums text-zinc-900 dark:text-zinc-100 text-right"
                                    : "py-1.5 px-2 text-zinc-900 dark:text-zinc-100 whitespace-nowrap truncate";
                            const content =
                              col === "ticker" && onSymbolSelect ? (
                                <button
                                  type="button"
                                  onClick={() => onSymbolSelect(row.symbol)}
                                  className="text-blue-600 dark:text-blue-400 hover:underline text-left font-mono"
                                >
                                  {row.symbol}
                                </button>
                              ) : (
                                formatCellValue(row, col, isScriptCol)
                              );
                            return (
                              <td
                                key={col}
                                className={cellClass}
                                style={{
                                  width: getColWidth(col),
                                  ...(col === "name" || col === "industry" || col === "sector" ? { maxWidth: getColWidth(col) } : {}),
                                }}
                                title={typeof content === "string" && content.length > 20 ? content : undefined}
                              >
                                {content}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {showColumnPicker && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={(e) => e.target === e.currentTarget && setShowColumnPicker(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="column-picker-title"
        >
          <div
            className="bg-white dark:bg-zinc-800 rounded-lg shadow-xl border border-zinc-200 dark:border-zinc-700 w-full max-w-md max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 flex items-center justify-between">
              <h2 id="column-picker-title" className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                Customize columns
              </h2>
              <button
                type="button"
                onClick={() => setShowColumnPicker(false)}
                className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-500"
                aria-label="Close"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              <ColumnPickerContent
                visibleColumns={visibleColumns}
                columnSets={columnSets}
                onSave={(cols, saveAsName) => {
                  setVisibleColumns(cols);
                  saveVisibleColumns(cols);
                  if (saveAsName) {
                    const newSet: ColumnSet = {
                      id: crypto.randomUUID(),
                      name: saveAsName,
                      columns: cols,
                      widths: { ...columnWidths },
                    };
                    const next = [...columnSets, newSet];
                    setColumnSets(next);
                    saveColumnSets(next);
                  }
                  setShowColumnPicker(false);
                }}
                onReset={() => {
                  setVisibleColumns([...DEFAULT_VISIBLE_COLUMNS]);
                  saveVisibleColumns(DEFAULT_VISIBLE_COLUMNS);
                  setShowColumnPicker(false);
                }}
                onCancel={() => setShowColumnPicker(false)}
                onApplySet={(set) => {
                  setVisibleColumns(set.columns);
                  setColumnWidths(set.widths ?? {});
                  saveVisibleColumns(set.columns);
                  saveColumnWidths(set.widths ?? {});
                }}
                onSaveSet={(set) => {
                  const next = columnSets.map((s) => (s.id === set.id ? set : s));
                  setColumnSets(next);
                  saveColumnSets(next);
                }}
                onDeleteSet={(id) => {
                  const next = columnSets.filter((s) => s.id !== id);
                  setColumnSets(next);
                  saveColumnSets(next);
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
