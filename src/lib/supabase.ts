import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

let _client: SupabaseClient | null = null;
let _serviceClient: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!url || !anonKey) return null;
  if (!_client) _client = createClient(url, anonKey);
  return _client;
}

/**
 * Server-only Supabase client (service role). Do not import from client components.
 * Used for cron upserts and other trusted server writes.
 */
export function getSupabaseService(): SupabaseClient | null {
  if (typeof window !== "undefined") return null;
  if (!url || !serviceRoleKey) return null;
  if (!_serviceClient) {
    _serviceClient = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return _serviceClient;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(url && anonKey);
}
