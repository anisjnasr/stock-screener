import type { NextRequest } from "next/server";
import { runMarketEventIngest } from "@/lib/sources/ingestMarketEventsShared";
import { fetchUstrPressListingHtml, parseUstrPressListingHtml } from "@/lib/sources/ustrPress";

/**
 * USTR press releases (trade/tariff keyword filter).
 * POST — Bearer CRON_SECRET.
 */
export async function POST(request: NextRequest) {
  return runMarketEventIngest(request, {
    source: "ustr",
    loadRows: async () => {
      const html = await fetchUstrPressListingHtml({ signal: request.signal });
      return parseUstrPressListingHtml(html);
    },
  });
}
