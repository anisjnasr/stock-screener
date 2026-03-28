/**
 * Lightweight cloud sync module — fire-and-forget writes to Supabase.
 * Kept separate from profile-storage to avoid circular imports
 * (the storage files import from here, and profile-storage imports types
 * from the storage files).
 */

import { getSupabase } from "./supabase";

const PROFILE_KEY = "stock-research-active-profile";

function profileId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.id ?? null;
  } catch {
    return null;
  }
}

export function cloudSyncSetting(key: string, value: unknown): void {
  const pid = profileId();
  const sb = getSupabase();
  if (!pid || !sb) return;
  sb.from("user_settings")
    .upsert({ profile_id: pid, key, value, updated_at: new Date().toISOString() }, { onConflict: "profile_id,key" })
    .then(({ error }) => { if (error) console.warn("[cloud-sync] setting", key, error.message); });
}

type WatchlistRow = { id: string; name: string; symbols: string[]; folderId?: string };
type WatchlistFolderRow = { id: string; name: string };

export function cloudSyncWatchlists(
  lists: WatchlistRow[],
  folders: WatchlistFolderRow[],
  favoriteIds: string[],
): void {
  const pid = profileId();
  const sb = getSupabase();
  if (!pid || !sb) return;

  const favSet = new Set(favoriteIds);

  (async () => {
    await sb.from("watchlists").delete().eq("profile_id", pid);
    await sb.from("watchlist_folders").delete().eq("profile_id", pid);

    if (folders.length > 0) {
      await sb.from("watchlist_folders").insert(
        folders.map((f) => ({ id: f.id, profile_id: pid, name: f.name }))
      );
    }
    if (lists.length > 0) {
      await sb.from("watchlists").insert(
        lists.map((l) => ({
          id: l.id,
          profile_id: pid,
          name: l.name,
          symbols: l.symbols,
          folder_id: l.folderId || null,
          is_favorite: favSet.has(l.id),
        }))
      );
    }
  })().catch((err) => console.warn("[cloud-sync] watchlists", err));
}

type ScreenRow = {
  id: string;
  name: string;
  universe: string;
  type?: string;
  filters: Record<string, unknown>;
  scriptBody?: string;
  folderId?: string | null;
  createdAt: string;
};
type ScreenFolderRow = { id: string; name: string; createdAt: string };

export function cloudSyncScreens(
  screens: ScreenRow[],
  folders: ScreenFolderRow[],
  favoriteIds: string[],
): void {
  const pid = profileId();
  const sb = getSupabase();
  if (!pid || !sb) return;

  const favSet = new Set(favoriteIds);

  (async () => {
    await sb.from("saved_screens").delete().eq("profile_id", pid);
    await sb.from("screen_folders").delete().eq("profile_id", pid);

    if (folders.length > 0) {
      await sb.from("screen_folders").insert(
        folders.map((f) => ({ id: f.id, profile_id: pid, name: f.name, created_at: f.createdAt }))
      );
    }
    if (screens.length > 0) {
      await sb.from("saved_screens").insert(
        screens.map((s) => ({
          id: s.id,
          profile_id: pid,
          name: s.name,
          universe: s.universe,
          type: s.type ?? "filter",
          filters: s.filters,
          script_body: s.scriptBody ?? null,
          folder_id: s.folderId || null,
          is_favorite: favSet.has(s.id),
          created_at: s.createdAt,
        }))
      );
    }
  })().catch((err) => console.warn("[cloud-sync] screens", err));
}

export function cloudSyncFlags(flags: Record<string, string>): void {
  const pid = profileId();
  const sb = getSupabase();
  if (!pid || !sb) return;

  (async () => {
    await sb.from("stock_flags").delete().eq("profile_id", pid);
    const rows = Object.entries(flags).map(([symbol, flag]) => ({ profile_id: pid, symbol, flag }));
    if (rows.length > 0) {
      await sb.from("stock_flags").insert(rows);
    }
  })().catch((err) => console.warn("[cloud-sync] flags", err));
}
