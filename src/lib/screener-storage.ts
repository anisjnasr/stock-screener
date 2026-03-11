/**
 * Saved screener definitions (name, universe, filters) and folders in localStorage.
 */

const STORAGE_KEY_SCREENS = "stock-research-screener-screens";
const STORAGE_KEY_FOLDERS = "stock-research-screener-folders";

export type ScreenerFilters = Record<string, string | number | undefined>;

export type SavedScreen = {
  id: string;
  name: string;
  universe: string;
  filters: ScreenerFilters;
  /** Id of folder this screen belongs to; null/undefined = root. */
  folderId?: string | null;
  /** "filter" = standard filter UI; "script" = custom script (scriptBody). Default "filter". */
  type?: "filter" | "script";
  /** Script text when type === "script". */
  scriptBody?: string;
  createdAt: string;
};

export type ScreenerFolder = {
  id: string;
  name: string;
  createdAt: string;
};

export function loadScreens(): SavedScreen[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SCREENS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : [];
    return list.map((s: { id?: string; name?: string; universe?: string; filters?: ScreenerFilters; folderId?: string | null; type?: "filter" | "script"; scriptBody?: string; createdAt?: string }) => ({
      id: typeof s.id === "string" ? s.id : crypto.randomUUID(),
      name: typeof s.name === "string" ? s.name : "Unnamed",
      universe: typeof s.universe === "string" ? s.universe : "all",
      filters: typeof s.filters === "object" && s.filters !== null ? (s.filters as ScreenerFilters) : {},
      folderId: s.folderId === undefined || s.folderId === "" ? undefined : (typeof s.folderId === "string" ? s.folderId : undefined),
      type: s.type === "script" ? "script" : "filter",
      scriptBody: typeof s.scriptBody === "string" ? s.scriptBody : undefined,
      createdAt: typeof s.createdAt === "string" ? s.createdAt : new Date().toISOString(),
    }));
  } catch {
    return [];
  }
}

export function saveScreens(screens: SavedScreen[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY_SCREENS, JSON.stringify(screens));
  } catch {
    /* ignore */
  }
}

export function addScreen(screen: Omit<SavedScreen, "id" | "createdAt">): SavedScreen {
  const screens = loadScreens();
  const newScreen: SavedScreen = {
    ...screen,
    folderId: screen.folderId ?? undefined,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };
  screens.push(newScreen);
  saveScreens(screens);
  return newScreen;
}

export function updateScreen(id: string, updates: Partial<Omit<SavedScreen, "id" | "createdAt">>): void {
  const screens = loadScreens();
  const idx = screens.findIndex((s) => s.id === id);
  if (idx >= 0) {
    screens[idx] = { ...screens[idx]!, ...updates };
    saveScreens(screens);
  }
}

export function deleteScreen(id: string): void {
  const screens = loadScreens().filter((s) => s.id !== id);
  saveScreens(screens);
}

// ——— Folders ———

export function loadFolders(): ScreenerFolder[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_FOLDERS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : [];
    return list.map((f: { id?: string; name?: string; createdAt?: string }) => ({
      id: typeof f.id === "string" ? f.id : crypto.randomUUID(),
      name: typeof f.name === "string" ? f.name : "Unnamed folder",
      createdAt: typeof f.createdAt === "string" ? f.createdAt : new Date().toISOString(),
    }));
  } catch {
    return [];
  }
}

export function saveFolders(folders: ScreenerFolder[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY_FOLDERS, JSON.stringify(folders));
  } catch {
    /* ignore */
  }
}

export function addFolder(folder: Omit<ScreenerFolder, "id" | "createdAt">): ScreenerFolder {
  const folders = loadFolders();
  const newFolder: ScreenerFolder = {
    ...folder,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };
  folders.push(newFolder);
  saveFolders(folders);
  return newFolder;
}

export function updateFolder(id: string, updates: Partial<Omit<ScreenerFolder, "id" | "createdAt">>): void {
  const folders = loadFolders();
  const idx = folders.findIndex((f) => f.id === id);
  if (idx >= 0) {
    folders[idx] = { ...folders[idx]!, ...updates };
    saveFolders(folders);
  }
}

export function deleteFolder(id: string): void {
  const folders = loadFolders().filter((f) => f.id !== id);
  saveFolders(folders);
  // Move screens in this folder to root
  const screens = loadScreens().map((s) =>
    s.folderId === id ? { ...s, folderId: undefined as string | undefined } : s
  );
  saveScreens(screens);
}

/** Universe options for the screener (stock list to filter within). */
export const UNIVERSE_OPTIONS: { id: string; name: string }[] = [
  { id: "all", name: "All stocks" },
  { id: "nasdaq100", name: "Nasdaq 100" },
  { id: "sp500", name: "S&P 500" },
  { id: "russell2000", name: "Russell 2000" },
];

/** Return IPO date range as YYYY-MM-DD: from (today - 24 months) to (today - 6 months). */
function getIpoDateRange6to24Months(): { from: string; to: string } {
  const to = new Date();
  to.setMonth(to.getMonth() - 6);
  const from = new Date();
  from.setMonth(from.getMonth() - 24);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

/**
 * Prebuilt screen definitions (no id/createdAt). Seed when user has no screens.
 */
export function getDefaultPrebuiltScreens(): Omit<SavedScreen, "id" | "createdAt">[] {
  const ipo = getIpoDateRange6to24Months();
  return [
    {
      name: "Top Gainers",
      universe: "all",
      type: "filter",
      filters: {
        price_change_1m_pct_min: 10,
        price_change_3m_pct_min: 15,
        price_change_6m_pct_min: 20,
        price_change_12m_pct_min: 25,
      },
    },
    {
      name: "IPOs",
      universe: "all",
      type: "filter",
      filters: {
        ipo_date_from: ipo.from,
        ipo_date_to: ipo.to,
        last_price_min: 5,
        avg_volume_30d_min: 25000, // ~500k monthly / 20 trading days
      },
    },
    {
      name: "Strong Momo",
      universe: "all",
      type: "filter",
      filters: {
        price_change_1m_pct_min: 20,
        last_price_min: 10,
        avg_volume_30d_min: 500000,
      },
    },
    {
      name: "Doublers",
      universe: "all",
      type: "filter",
      filters: {
        price_change_12m_pct_min: 100,
        last_price_min: 10,
        avg_volume_30d_min: 500000,
      },
    },
    {
      name: "Pullbacks",
      universe: "all",
      type: "script",
      scriptBody: `P > 10 AND MA(V, 20) > 1000000 AND MA(C, 200) > MA(C, 200, 30) AND P > MA(C, 100) AND P > MA(C, 200) AND MA(C, 100) > MA(C, 200) AND MA(C, 50) > MA(C, 100) AND P < MA(C, 50)`,
      filters: {},
    },
    {
      name: "Parabolic Short",
      universe: "all",
      type: "script",
      scriptBody: `ROC(C, 5) >= 100 AND P > 5 AND MA(V, 20) >= 100000`,
      filters: {},
    },
    {
      name: "Episodic Pivot (EP)",
      universe: "all",
      type: "script",
      scriptBody: `ROC(C, 1, 1) >= 10 AND P > 15 AND MA(V, 20) > 1000000 AND P > MA(C, 200) AND V[1] / MA(V, 20, 1) >= 2`,
      filters: {},
    },
    {
      name: "High Tight Flag",
      universe: "all",
      type: "script",
      scriptBody: `ROC(C, 40) >= 100 AND P >= 0.8 * MAX(H, 40) AND P > 15 AND MA(V, 20) > 500000`,
      filters: {},
    },
  ];
}

/** If no screens exist, add prebuilt screens and save. Call on app load. */
export function seedDefaultScreensIfEmpty(): void {
  const current = loadScreens();
  if (current.length > 0) return;
  getDefaultPrebuiltScreens().forEach((s) => addScreen(s));
}
