import type { SupabaseClient } from "@supabase/supabase-js";
import type { BigNameUniverseInsert, EarningsCalendarInsert } from "@/types/earnings-calendar";

const CHUNK = 200;

export async function upsertBigNameUniverse(
  supabase: SupabaseClient,
  rows: BigNameUniverseInsert[]
): Promise<{ upserted: number; errors: string[] }> {
  const errors: string[] = [];
  let upserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { error } = await supabase.from("big_name_universe").upsert(slice, { onConflict: "ticker" });
    if (error) {
      errors.push(`big_name_universe chunk ${i}: ${error.message}`);
    } else {
      upserted += slice.length;
    }
  }
  return { upserted, errors };
}

export async function upsertEarningsCalendar(
  supabase: SupabaseClient,
  rows: EarningsCalendarInsert[]
): Promise<{ upserted: number; errors: string[] }> {
  const errors: string[] = [];
  let upserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { error } = await supabase.from("earnings_calendar").upsert(slice, {
      onConflict: "ticker,report_date,quarter,year",
    });
    if (error) {
      errors.push(`earnings_calendar chunk ${i}: ${error.message}`);
    } else {
      upserted += slice.length;
    }
  }
  return { upserted, errors };
}
