/**
 * Lightweight cloud sync module — fire-and-forget writes to Supabase.
 * Kept separate from profile-storage to avoid circular imports
 * (the storage files import from here, and profile-storage imports types
 * from the storage files).
 */

import { getSupabase } from "./supabase";

const PROFILE_KEY = "stock-research-active-profile";
const syncQueues = new Map<string, Promise<void>>();

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(label: string, task: () => Promise<T>, retries = 1): Promise<T> {
  let attempt = 0;
  let lastError: unknown = null;
  while (attempt <= retries) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (attempt >= retries) break;
      console.warn(`[cloud-sync] retrying ${label} (attempt ${attempt + 2}/${retries + 1})`);
      await sleep(200);
      attempt += 1;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function ensureNoError(
  profile: string,
  table: string,
  operation: "insert" | "delete" | "upsert",
  error: { message?: string } | null | undefined
): void {
  if (!error) return;
  const msg = error.message ?? "unknown error";
  throw new Error(`${table}.${operation} failed for profile=${profile}: ${msg}`);
}

function enqueueSync(queueKey: string, task: () => Promise<void>): void {
  const prev = syncQueues.get(queueKey) ?? Promise.resolve();
  const next = prev
    .catch(() => {
      // Keep queue alive even if previous run failed.
    })
    .then(task)
    .catch((err) => {
      console.warn(`[cloud-sync] ${queueKey}`, err);
    });
  syncQueues.set(queueKey, next.finally(() => {
    if (syncQueues.get(queueKey) === next) {
      syncQueues.delete(queueKey);
    }
  }));
}

export function cloudSyncSetting(key: string, value: unknown): void {
  const pid = profileId();
  const sb = getSupabase();
  if (!pid || !sb) return;
  enqueueSync(`setting:${pid}:${key}`, async () => {
    await withRetry(`setting:${key}`, async () => {
      const { error } = await sb
        .from("user_settings")
        .upsert(
          { profile_id: pid, key, value, updated_at: new Date().toISOString() },
          { onConflict: "profile_id,key" }
        );
      ensureNoError(pid, "user_settings", "upsert", error);
    });
  });
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

  enqueueSync(`watchlists:${pid}`, async () => {
    await withRetry("watchlists", async () => {
      const deleteWatchlists = await sb
        .from("watchlists")
        .delete()
        .eq("profile_id", pid);
      ensureNoError(pid, "watchlists", "delete", deleteWatchlists.error);
      const deleteFolders = await sb
        .from("watchlist_folders")
        .delete()
        .eq("profile_id", pid);
      ensureNoError(pid, "watchlist_folders", "delete", deleteFolders.error);

      if (folders.length > 0) {
        const insertFolders = await sb.from("watchlist_folders").insert(
          folders.map((f) => ({ id: f.id, profile_id: pid, name: f.name }))
        );
        ensureNoError(pid, "watchlist_folders", "insert", insertFolders.error);
      }
      if (lists.length > 0) {
        const insertLists = await sb.from("watchlists").insert(
          lists.map((l) => ({
            id: l.id,
            profile_id: pid,
            name: l.name,
            symbols: l.symbols,
            folder_id: l.folderId || null,
            is_favorite: favSet.has(l.id),
          }))
        );
        ensureNoError(pid, "watchlists", "insert", insertLists.error);
      }
    });
  });
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

  enqueueSync(`screens:${pid}`, async () => {
    await withRetry("screens", async () => {
      const deleteScreens = await sb
        .from("saved_screens")
        .delete()
        .eq("profile_id", pid);
      ensureNoError(pid, "saved_screens", "delete", deleteScreens.error);
      const deleteFolders = await sb
        .from("screen_folders")
        .delete()
        .eq("profile_id", pid);
      ensureNoError(pid, "screen_folders", "delete", deleteFolders.error);

      if (folders.length > 0) {
        const insertFolders = await sb.from("screen_folders").insert(
          folders.map((f) => ({ id: f.id, profile_id: pid, name: f.name, created_at: f.createdAt }))
        );
        ensureNoError(pid, "screen_folders", "insert", insertFolders.error);
      }
      if (screens.length > 0) {
        const insertScreens = await sb.from("saved_screens").insert(
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
        ensureNoError(pid, "saved_screens", "insert", insertScreens.error);
      }
    });
  });
}

export function cloudSyncFlags(flags: Record<string, string>): void {
  const pid = profileId();
  const sb = getSupabase();
  if (!pid || !sb) return;

  enqueueSync(`flags:${pid}`, async () => {
    await withRetry("flags", async () => {
      const deleteFlags = await sb
        .from("stock_flags")
        .delete()
        .eq("profile_id", pid);
      ensureNoError(pid, "stock_flags", "delete", deleteFlags.error);
      const rows = Object.entries(flags).map(([symbol, flag]) => ({ profile_id: pid, symbol, flag }));
      if (rows.length > 0) {
        const insertFlags = await sb.from("stock_flags").insert(rows);
        ensureNoError(pid, "stock_flags", "insert", insertFlags.error);
      }
    });
  });
}
