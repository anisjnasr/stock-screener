/**
 * Watchlist and stock flags persisted in localStorage.
 * Lists: id -> { name, symbolIds }
 * Flags: symbol -> 'red' | 'yellow' | 'green' | 'blue' (global across lists)
 */

const STORAGE_KEY_LISTS = "stock-research-watchlists";
const STORAGE_KEY_LIST_FOLDERS = "stock-research-watchlist-folders";
const STORAGE_KEY_FLAGS = "stock-research-stock-flags";
const STORAGE_KEY_PANEL = "stock-research-watchlist-panel";
const STORAGE_KEY_PANEL_HEIGHT = "stock-research-watchlist-panel-height-px";
const STORAGE_KEY_SIDEBAR_WIDTH = "stock-research-watchlist-sidebar-width-px";
const STORAGE_KEY_COLUMNS = "stock-research-watchlist-column-widths";
const STORAGE_KEY_VISIBLE_COLUMNS = "stock-research-watchlist-visible-columns";
const STORAGE_KEY_COLUMN_SETS = "stock-research-watchlist-column-sets";

export type Watchlist = {
  id: string;
  name: string;
  symbols: string[];
  folderId?: string;
};

export type StockFlag = "red" | "yellow" | "green" | "blue";

export type WatchlistFolder = {
  id: string;
  name: string;
};

export type WatchlistPanelMode = "minimized" | "medium" | "full";

export function loadWatchlists(): Watchlist[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_LISTS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : [];
    return list.map((l: { id?: string; name?: string; symbols?: string[] }) => ({
      id: typeof l.id === "string" ? l.id : crypto.randomUUID(),
      name: typeof l.name === "string" ? l.name : "Unnamed",
      symbols: Array.isArray(l.symbols) ? l.symbols : [],
      folderId: typeof (l as { folderId?: unknown }).folderId === "string" ? String((l as { folderId?: string }).folderId) : undefined,
    }));
  } catch {
    return [];
  }
}

export function saveWatchlists(lists: Watchlist[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY_LISTS, JSON.stringify(lists));
  } catch {
    /* ignore */
  }
}

export function loadWatchlistFolders(): WatchlistFolder[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_LIST_FOLDERS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : [];
    return list
      .map((f: { id?: string; name?: string }) => ({
        id: typeof f.id === "string" ? f.id : crypto.randomUUID(),
        name: typeof f.name === "string" ? f.name : "Unnamed Folder",
      }))
      .filter((f) => f.name.trim() !== "");
  } catch {
    return [];
  }
}

export function saveWatchlistFolders(folders: WatchlistFolder[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY_LIST_FOLDERS, JSON.stringify(folders));
  } catch {
    /* ignore */
  }
}

export function loadFlags(): Record<string, StockFlag> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY_FLAGS);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export function saveFlags(flags: Record<string, StockFlag>): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY_FLAGS, JSON.stringify(flags));
  } catch {
    /* ignore */
  }
}

export function loadPanelMode(): WatchlistPanelMode {
  if (typeof window === "undefined") return "minimized";
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PANEL);
    if (raw === "medium" || raw === "full" || raw === "minimized") return raw;
    return "minimized";
  } catch {
    return "minimized";
  }
}

export function savePanelMode(mode: WatchlistPanelMode): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY_PANEL, mode);
  } catch {
    /* ignore */
  }
}

const DEFAULT_PANEL_HEIGHT_PX = 32;
const MIN_PANEL_HEIGHT_PX = 32;

export function loadPanelHeightPx(): number {
  if (typeof window === "undefined") return DEFAULT_PANEL_HEIGHT_PX;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PANEL_HEIGHT);
    if (raw == null) return DEFAULT_PANEL_HEIGHT_PX;
    const n = Number(raw);
    return Number.isFinite(n) && n >= MIN_PANEL_HEIGHT_PX ? n : DEFAULT_PANEL_HEIGHT_PX;
  } catch {
    return DEFAULT_PANEL_HEIGHT_PX;
  }
}

export function savePanelHeightPx(px: number): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY_PANEL_HEIGHT, String(Math.round(px)));
  } catch {
    /* ignore */
  }
}

const DEFAULT_SIDEBAR_WIDTH_PX = 224;
const MIN_SIDEBAR_WIDTH_PX = 160;
const MAX_SIDEBAR_WIDTH_PX = 420;

export function loadSidebarWidthPx(): number {
  if (typeof window === "undefined") return DEFAULT_SIDEBAR_WIDTH_PX;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SIDEBAR_WIDTH);
    if (raw == null) return DEFAULT_SIDEBAR_WIDTH_PX;
    const n = Number(raw);
    return Number.isFinite(n) && n >= MIN_SIDEBAR_WIDTH_PX && n <= MAX_SIDEBAR_WIDTH_PX ? n : DEFAULT_SIDEBAR_WIDTH_PX;
  } catch {
    return DEFAULT_SIDEBAR_WIDTH_PX;
  }
}

export function saveSidebarWidthPx(px: number): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY_SIDEBAR_WIDTH, String(Math.round(px)));
  } catch {
    /* ignore */
  }
}

export type ColumnId =
  | "ticker"
  | "name"
  | "exchange"
  | "industry"
  | "sector"
  | "date"
  | "marketCap"
  | "lastPrice"
  | "changePct"
  | "volume"
  | "avgVolume"
  | "atrPct"
  | "high52w"
  | "off52wHighPct"
  | "priceChange1wPct"
  | "priceChange1mPct"
  | "priceChange3mPct"
  | "priceChange6mPct"
  | "priceChange12mPct"
  | "rsVsSpy1w"
  | "rsVsSpy1m"
  | "rsVsSpy3m"
  | "rsVsSpy6m"
  | "rsVsSpy12m"
  | "rsPct1w"
  | "rsPct1m"
  | "rsPct3m"
  | "rsPct6m"
  | "rsPct12m"
  | "industryRank1m"
  | "industryRank3m"
  | "industryRank6m"
  | "industryRank12m"
  | "sectorRank1m"
  | "sectorRank3m"
  | "sectorRank6m"
  | "sectorRank12m";

/** All columns that can be shown (screener + watchlist data points). */
export const ALL_COLUMN_IDS: ColumnId[] = [
  "ticker",
  "name",
  "exchange",
  "industry",
  "sector",
  "date",
  "marketCap",
  "lastPrice",
  "changePct",
  "volume",
  "avgVolume",
  "atrPct",
  "high52w",
  "off52wHighPct",
  "priceChange1wPct",
  "priceChange1mPct",
  "priceChange3mPct",
  "priceChange6mPct",
  "priceChange12mPct",
  "rsVsSpy1w",
  "rsVsSpy1m",
  "rsVsSpy3m",
  "rsVsSpy6m",
  "rsVsSpy12m",
  "rsPct1w",
  "rsPct1m",
  "rsPct3m",
  "rsPct6m",
  "rsPct12m",
  "industryRank1m",
  "industryRank3m",
  "industryRank6m",
  "industryRank12m",
  "sectorRank1m",
  "sectorRank3m",
  "sectorRank6m",
  "sectorRank12m",
];

export const COLUMN_LABELS: Record<ColumnId, string> = {
  ticker: "Ticker",
  name: "Name",
  exchange: "Exchange",
  industry: "Industry",
  sector: "Sector",
  date: "Date",
  marketCap: "Market Cap (bn)",
  lastPrice: "Last Price",
  changePct: "Change %",
  volume: "Volume",
  avgVolume: "Avg Volume",
  atrPct: "ATR %",
  high52w: "52W High",
  off52wHighPct: "Off 52W High %",
  priceChange1wPct: "Chg 1W %",
  priceChange1mPct: "Chg 1M %",
  priceChange3mPct: "Chg 3M %",
  priceChange6mPct: "Chg 6M %",
  priceChange12mPct: "Chg 12M %",
  rsVsSpy1w: "RS vs SPY 1W",
  rsVsSpy1m: "RS vs SPY 1M",
  rsVsSpy3m: "RS vs SPY 3M",
  rsVsSpy6m: "RS vs SPY 6M",
  rsVsSpy12m: "RS vs SPY 12M",
  rsPct1w: "RS % 1W",
  rsPct1m: "RS % 1M",
  rsPct3m: "RS % 3M",
  rsPct6m: "RS % 6M",
  rsPct12m: "RS % 12M",
  industryRank1m: "Ind Rank 1M",
  industryRank3m: "Ind Rank 3M",
  industryRank6m: "Ind Rank 6M",
  industryRank12m: "Ind Rank 12M",
  sectorRank1m: "Sec Rank 1M",
  sectorRank3m: "Sec Rank 3M",
  sectorRank6m: "Sec Rank 6M",
  sectorRank12m: "Sec Rank 12M",
};

/** Columns that are numeric (right-align, sortable as number). */
export const NUMERIC_COLUMN_IDS = new Set<ColumnId>([
  "marketCap",
  "lastPrice",
  "changePct",
  "volume",
  "avgVolume",
  "atrPct",
  "high52w",
  "off52wHighPct",
  "priceChange1wPct",
  "priceChange1mPct",
  "priceChange3mPct",
  "priceChange6mPct",
  "priceChange12mPct",
  "rsVsSpy1w",
  "rsVsSpy1m",
  "rsVsSpy3m",
  "rsVsSpy6m",
  "rsVsSpy12m",
  "rsPct1w",
  "rsPct1m",
  "rsPct3m",
  "rsPct6m",
  "rsPct12m",
  "industryRank1m",
  "industryRank3m",
  "industryRank6m",
  "industryRank12m",
  "sectorRank1m",
  "sectorRank3m",
  "sectorRank6m",
  "sectorRank12m",
]);

/** Default visible columns (order) when none saved. */
export const DEFAULT_VISIBLE_COLUMNS: ColumnId[] = [
  "ticker",
  "name",
  "marketCap",
  "lastPrice",
  "changePct",
  "volume",
  "avgVolume",
  "atrPct",
  "industry",
  "sector",
];

export const SECTION_DEFAULT_COLUMNS: Record<string, ColumnId[]> = {
  indices: ["ticker", "lastPrice", "changePct", "atrPct", "priceChange1mPct", "priceChange3mPct", "priceChange6mPct", "priceChange12mPct"],
  sectors: ["ticker", "lastPrice", "changePct", "atrPct", "priceChange1mPct", "priceChange3mPct", "priceChange6mPct", "priceChange12mPct"],
  scans: ["ticker", "lastPrice", "changePct"],
  lists: ["ticker", "lastPrice", "changePct", "marketCap", "volume", "avgVolume", "atrPct"],
};

export function loadVisibleColumns(): ColumnId[] {
  if (typeof window === "undefined") return [...DEFAULT_VISIBLE_COLUMNS];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_VISIBLE_COLUMNS);
    if (!raw) return [...DEFAULT_VISIBLE_COLUMNS];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_VISIBLE_COLUMNS];
    const valid = parsed.filter((id: unknown) => typeof id === "string" && ALL_COLUMN_IDS.includes(id as ColumnId));
    return valid.length > 0 ? (valid as ColumnId[]) : [...DEFAULT_VISIBLE_COLUMNS];
  } catch {
    return [...DEFAULT_VISIBLE_COLUMNS];
  }
}

export function saveVisibleColumns(columns: ColumnId[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY_VISIBLE_COLUMNS, JSON.stringify(columns));
  } catch {
    /* ignore */
  }
}

export function loadColumnWidths(): Partial<Record<ColumnId, number>> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY_COLUMNS);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export function saveColumnWidths(widths: Partial<Record<ColumnId, number>>): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY_COLUMNS, JSON.stringify(widths));
  } catch {
    /* ignore */
  }
}

export type ColumnSet = {
  id: string;
  name: string;
  columns: ColumnId[];
  widths?: Partial<Record<ColumnId, number>>;
};

export function loadColumnSets(): ColumnSet[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_COLUMN_SETS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s: unknown): s is ColumnSet =>
        typeof s === "object" &&
        s !== null &&
        typeof (s as ColumnSet).id === "string" &&
        typeof (s as ColumnSet).name === "string" &&
        Array.isArray((s as ColumnSet).columns)
    );
  } catch {
    return [];
  }
}

export function saveColumnSets(sets: ColumnSet[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY_COLUMN_SETS, JSON.stringify(sets));
  } catch {
    /* ignore */
  }
}
