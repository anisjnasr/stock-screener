import type { SupabaseClient } from "@supabase/supabase-js";
import type { MarketEventInsert } from "@/types/market-events";

const CHUNK = 200;

export type UpsertMarketEventsResult = {
  upserted: number;
  errors: string[];
};

export async function upsertMarketEvents(
  supabase: SupabaseClient,
  rows: MarketEventInsert[]
): Promise<UpsertMarketEventsResult> {
  const errors: string[] = [];
  let upserted = 0;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { error } = await supabase.from("market_events").upsert(slice, {
      onConflict: "event_date,event_title,event_category",
    });
    if (error) {
      errors.push(`chunk ${i}-${i + slice.length}: ${error.message}`);
      for (const row of slice) {
        const { error: oneErr } = await supabase.from("market_events").upsert(row, {
          onConflict: "event_date,event_title,event_category",
        });
        if (oneErr) errors.push(`${row.event_date} ${row.event_title}: ${oneErr.message}`);
        else upserted += 1;
      }
    } else {
      upserted += slice.length;
    }
  }

  return { upserted, errors };
}
