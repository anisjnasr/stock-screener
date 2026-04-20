import type { NextRequest } from "next/server";
import { addCalendarMonth, fedMonthPathSegment, yearMonthInEt } from "@/lib/et-ymd";
import { runMarketEventIngest } from "@/lib/sources/ingestMarketEventsShared";
import { fetchFedMonthlyHtml, parseFedMonthlyCalendarHtml } from "@/lib/sources/fedCalendar";
import type { MarketEventInsert } from "@/types/market-events";

/**
 * Fed calendar (monthly HTML) → `market_events`.
 * POST — Bearer CRON_SECRET. Schedule per master spec: weekly Sunday 10 PM ET.
 */
export async function POST(request: NextRequest) {
  return runMarketEventIngest(request, {
    source: "fed",
    loadRows: async () => {
      const { y, m } = yearMonthInEt();
      const months = [0, 1].map((d) => addCalendarMonth(y, m, d));
      const rows: MarketEventInsert[] = [];
      for (const mm of months) {
        const path = fedMonthPathSegment(mm.y, mm.m);
        const html = await fetchFedMonthlyHtml(path, { signal: request.signal });
        rows.push(...parseFedMonthlyCalendarHtml(html));
      }
      return rows;
    },
  });
}
