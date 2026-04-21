import type { SupabaseClient } from "@supabase/supabase-js";
import type { EconomicEventInsert } from "@/lib/sources/forexFactoryCalendar";

const CHUNK = 200;

export type UpsertEconomicEventsResult = {
  upserted: number;
  errors: string[];
};

/**
 * Upsert economic events on (event_date, event_name, country) — matches unique index `idx_econ_dedupe`.
 */
export async function upsertEconomicEvents(
  supabase: SupabaseClient,
  rows: EconomicEventInsert[]
): Promise<UpsertEconomicEventsResult> {
  const errors: string[] = [];
  let upserted = 0;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK).map(({ actual: _omit, ...rest }) => rest);
    const { error } = await supabase.from("economic_events").upsert(slice, {
      onConflict: "event_date,event_name,country",
    });
    if (error) {
      errors.push(`chunk ${i}-${i + slice.length}: ${error.message}`);
      for (const row of slice) {
        const { actual: _o, ...rest } = row;
        const { error: oneErr } = await supabase.from("economic_events").upsert(rest, {
          onConflict: "event_date,event_name,country",
        });
        if (oneErr) errors.push(`${row.event_date} ${row.event_name}: ${oneErr.message}`);
        else upserted += 1;
      }
    } else {
      upserted += slice.length;
    }
  }

  return { upserted, errors };
}
