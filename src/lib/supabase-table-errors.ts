/** PostgREST / Supabase-js when the table has not been created yet. */
export function isSupabaseTableMissingError(message: string): boolean {
  return /could not find the table\b/i.test(message) && /schema cache/i.test(message);
}
