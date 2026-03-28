/**
 * Profile-aware storage layer backed by Supabase.
 *
 * Login: username + 4-digit PIN.
 * All user-specific data (watchlists, screens, flags, settings) is synced to
 * Supabase so it's available on any device. localStorage is kept as a fast
 * write-through cache.
 */

import { getSupabase, isSupabaseConfigured } from "./supabase";
import { cloudSyncSetting, cloudSyncWatchlists, cloudSyncScreens, cloudSyncFlags } from "./cloud-sync";
import type { Watchlist, WatchlistFolder, StockFlag, ColumnSet, ColumnId, WatchlistPanelMode } from "./watchlist-storage";
import type { SavedScreen, ScreenerFolder } from "./screener-storage";
import type { ChartSettings } from "./chart-settings";

const PROFILE_KEY = "stock-research-active-profile";

export type Profile = {
  id: string;
  username: string;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Active profile helpers
// ---------------------------------------------------------------------------

export function getActiveProfile(): Profile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setActiveProfile(profile: Profile | null): void {
  if (typeof window === "undefined") return;
  if (profile) {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } else {
    localStorage.removeItem(PROFILE_KEY);
  }
}

// ---------------------------------------------------------------------------
// Auth: login / register
// ---------------------------------------------------------------------------

export type AuthResult =
  | { ok: true; profile: Profile }
  | { ok: false; error: string };

export async function loginOrRegister(
  username: string,
  pin: string
): Promise<AuthResult> {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: "Supabase not configured" };

  const name = username.trim().toLowerCase();
  if (!name) return { ok: false, error: "Name is required" };
  if (!/^\d{4}$/.test(pin)) return { ok: false, error: "PIN must be 4 digits" };

  const { data: existing, error: lookupErr } = await sb
    .from("profiles")
    .select("id, username, pin, created_at")
    .eq("username", name)
    .maybeSingle();

  if (lookupErr) return { ok: false, error: lookupErr.message };

  if (existing) {
    if (existing.pin !== pin) return { ok: false, error: "Incorrect PIN" };
    const profile: Profile = { id: existing.id, username: existing.username, created_at: existing.created_at };
    setActiveProfile(profile);
    return { ok: true, profile };
  }

  const { data: created, error: createErr } = await sb
    .from("profiles")
    .insert({ username: name, pin })
    .select("id, username, created_at")
    .single();

  if (createErr) return { ok: false, error: createErr.message };

  const profile: Profile = { id: created.id, username: created.username, created_at: created.created_at };
  setActiveProfile(profile);
  return { ok: true, profile };
}

export function logout(): void {
  setActiveProfile(null);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function profileId(): string | null {
  return getActiveProfile()?.id ?? null;
}

// ---------------------------------------------------------------------------
// Sync helpers — delegate to cloud-sync module
// ---------------------------------------------------------------------------

export const syncSetting = cloudSyncSetting;
export const syncWatchlists = cloudSyncWatchlists;
export const syncScreens = cloudSyncScreens;
export const syncFlags = cloudSyncFlags;

// ---------------------------------------------------------------------------
// Pull from Supabase → localStorage  (called once on login)
// ---------------------------------------------------------------------------

export type ProfileData = {
  watchlists: Watchlist[];
  watchlistFolders: WatchlistFolder[];
  favoriteWatchlistIds: string[];
  screens: SavedScreen[];
  screenFolders: ScreenerFolder[];
  favoriteScreenIds: string[];
  flags: Record<string, StockFlag>;
  settings: Record<string, unknown>;
};

export async function pullProfileData(): Promise<ProfileData | null> {
  const pid = profileId();
  const sb = getSupabase();
  if (!pid || !sb) return null;

  const [wlRes, wfRes, scRes, sfRes, flRes, stRes] = await Promise.all([
    sb.from("watchlists").select("*").eq("profile_id", pid),
    sb.from("watchlist_folders").select("*").eq("profile_id", pid),
    sb.from("saved_screens").select("*").eq("profile_id", pid),
    sb.from("screen_folders").select("*").eq("profile_id", pid),
    sb.from("stock_flags").select("*").eq("profile_id", pid),
    sb.from("user_settings").select("*").eq("profile_id", pid),
  ]);

  const watchlistFolders: WatchlistFolder[] = (wfRes.data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    name: r.name as string,
  }));

  const watchlists: Watchlist[] = (wlRes.data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    name: r.name as string,
    symbols: (r.symbols as string[]) ?? [],
    folderId: (r.folder_id as string) ?? undefined,
  }));

  const favoriteWatchlistIds = (wlRes.data ?? [])
    .filter((r: Record<string, unknown>) => r.is_favorite)
    .map((r: Record<string, unknown>) => r.id as string);

  const screenFolders: ScreenerFolder[] = (sfRes.data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    name: r.name as string,
    createdAt: (r.created_at as string) ?? new Date().toISOString(),
  }));

  const screens: SavedScreen[] = (scRes.data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    name: r.name as string,
    universe: (r.universe as string) ?? "all",
    type: (r.type as "filter" | "script") ?? "filter",
    filters: (r.filters as Record<string, string | number | undefined>) ?? {},
    scriptBody: (r.script_body as string) ?? undefined,
    folderId: (r.folder_id as string) ?? undefined,
    createdAt: (r.created_at as string) ?? new Date().toISOString(),
  }));

  const favoriteScreenIds = (scRes.data ?? [])
    .filter((r: Record<string, unknown>) => r.is_favorite)
    .map((r: Record<string, unknown>) => r.id as string);

  const flags: Record<string, StockFlag> = {};
  for (const r of flRes.data ?? []) {
    flags[r.symbol as string] = r.flag as StockFlag;
  }

  const settings: Record<string, unknown> = {};
  for (const r of stRes.data ?? []) {
    settings[r.key as string] = r.value;
  }

  return {
    watchlists,
    watchlistFolders,
    favoriteWatchlistIds,
    screens,
    screenFolders,
    favoriteScreenIds,
    flags,
    settings,
  };
}

/**
 * After pulling profile data, write it into localStorage so the existing
 * storage helpers pick it up transparently.
 */
export function hydrateLocalStorage(data: ProfileData): void {
  if (typeof window === "undefined") return;
  const s = localStorage;

  s.setItem("stock-research-watchlists", JSON.stringify(data.watchlists));
  s.setItem("stock-research-watchlist-folders", JSON.stringify(data.watchlistFolders));
  s.setItem("stock-research-favorite-watchlist-ids", JSON.stringify(data.favoriteWatchlistIds));
  s.setItem("stock-research-stock-flags", JSON.stringify(data.flags));

  s.setItem("stock-research-screener-screens", JSON.stringify(data.screens));
  s.setItem("stock-research-screener-folders", JSON.stringify(data.screenFolders));
  s.setItem("stock-research-favorite-screen-ids", JSON.stringify(data.favoriteScreenIds));

  const st = data.settings;
  if (st.theme !== undefined) s.setItem("stock-research-theme", JSON.stringify(st.theme));
  if (st.chart_settings !== undefined) s.setItem("stock-research-chart-settings", JSON.stringify(st.chart_settings));
  if (st.flag_names !== undefined) s.setItem("stock-research-flag-names", JSON.stringify(st.flag_names));
  if (st.visible_columns !== undefined) s.setItem("stock-research-watchlist-visible-columns", JSON.stringify(st.visible_columns));
  if (st.column_widths !== undefined) s.setItem("stock-research-watchlist-column-widths", JSON.stringify(st.column_widths));
  if (st.column_sets !== undefined) s.setItem("stock-research-watchlist-column-sets", JSON.stringify(st.column_sets));
  if (st.panel_mode !== undefined) s.setItem("stock-research-watchlist-panel", st.panel_mode as string);
  if (st.panel_height !== undefined) s.setItem("stock-research-watchlist-panel-height-px", String(st.panel_height));
  if (st.sidebar_width !== undefined) s.setItem("stock-research-watchlist-sidebar-width-px", String(st.sidebar_width));
  if (st.layout_preferences !== undefined) {
    const lp = st.layout_preferences as Record<string, unknown>;
    if (lp.chartLeftPx !== undefined) s.setItem("ws-chart-left-px", String(lp.chartLeftPx));
    if (lp.chartLeftSectorsPx !== undefined) s.setItem("ws-chart-left-sectors-px", String(lp.chartLeftSectorsPx));
    if (lp.railWidthPx !== undefined) s.setItem("ws-rail-width-px", String(lp.railWidthPx));
    if (lp.rightRailHidden !== undefined) s.setItem("ws-right-rail-hidden", String(lp.rightRailHidden));
    if (lp.leftSidebarHidden !== undefined) s.setItem("stock-research-left-sidebar-hidden", String(lp.leftSidebarHidden));
    if (lp.quarterlyHidden !== undefined) s.setItem("stock-research-quarterly-hidden", String(lp.quarterlyHidden));
  }
}

/**
 * Push everything currently in localStorage up to Supabase.
 * Used on first login from a device that already has local data.
 */
export function pushLocalStorageToCloud(): void {
  const pid = profileId();
  if (!pid) return;
  const s = localStorage;

  try {
    const wl = JSON.parse(s.getItem("stock-research-watchlists") ?? "[]") as Watchlist[];
    const wf = JSON.parse(s.getItem("stock-research-watchlist-folders") ?? "[]") as WatchlistFolder[];
    const favWl = JSON.parse(s.getItem("stock-research-favorite-watchlist-ids") ?? "[]") as string[];
    syncWatchlists(wl, wf, favWl);
  } catch { /* skip */ }

  try {
    const sc = JSON.parse(s.getItem("stock-research-screener-screens") ?? "[]") as SavedScreen[];
    const sf = JSON.parse(s.getItem("stock-research-screener-folders") ?? "[]") as ScreenerFolder[];
    const favSc = JSON.parse(s.getItem("stock-research-favorite-screen-ids") ?? "[]") as string[];
    syncScreens(sc, sf, favSc);
  } catch { /* skip */ }

  try {
    const fl = JSON.parse(s.getItem("stock-research-stock-flags") ?? "{}") as Record<string, StockFlag>;
    syncFlags(fl);
  } catch { /* skip */ }

  const settingKeys: [string, string][] = [
    ["stock-research-theme", "theme"],
    ["stock-research-chart-settings", "chart_settings"],
    ["stock-research-flag-names", "flag_names"],
    ["stock-research-watchlist-visible-columns", "visible_columns"],
    ["stock-research-watchlist-column-widths", "column_widths"],
    ["stock-research-watchlist-column-sets", "column_sets"],
    ["stock-research-watchlist-panel", "panel_mode"],
    ["stock-research-watchlist-panel-height-px", "panel_height"],
    ["stock-research-watchlist-sidebar-width-px", "sidebar_width"],
  ];

  for (const [lsKey, dbKey] of settingKeys) {
    try {
      const raw = s.getItem(lsKey);
      if (raw != null) {
        const val = tryParse(raw);
        syncSetting(dbKey, val);
      }
    } catch { /* skip */ }
  }

  try {
    const lp: Record<string, unknown> = {};
    const tryNum = (k: string) => { const v = s.getItem(k); return v != null ? Number(v) : undefined; };
    const tryBool = (k: string) => { const v = s.getItem(k); return v != null ? v === "true" : undefined; };
    lp.chartLeftPx = tryNum("ws-chart-left-px");
    lp.chartLeftSectorsPx = tryNum("ws-chart-left-sectors-px");
    lp.railWidthPx = tryNum("ws-rail-width-px");
    lp.rightRailHidden = tryBool("ws-right-rail-hidden");
    lp.leftSidebarHidden = tryBool("stock-research-left-sidebar-hidden");
    lp.quarterlyHidden = tryBool("stock-research-quarterly-hidden");
    syncSetting("layout_preferences", lp);
  } catch { /* skip */ }
}

function tryParse(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return raw; }
}

// Re-export types used by consumers
export type { Watchlist, WatchlistFolder, StockFlag, ColumnSet, ColumnId, WatchlistPanelMode };
export type { SavedScreen, ScreenerFolder };
export type { ChartSettings };
