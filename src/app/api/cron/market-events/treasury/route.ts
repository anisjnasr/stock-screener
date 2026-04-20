import type { NextRequest } from "next/server";
import { runMarketEventIngest } from "@/lib/sources/ingestMarketEventsShared";
import {
  fetchTreasuryAnnouncedJson,
  fetchTreasuryPressReleasesHtml,
  parseTreasuryAnnouncedJson,
  parseTreasuryPressListingHtml,
} from "@/lib/sources/treasuryPolicy";

/**
 * Treasury auctions (JSON) + filtered press releases (HTML listing).
 * POST — Bearer CRON_SECRET.
 */
export async function POST(request: NextRequest) {
  return runMarketEventIngest(request, {
    source: "treasury",
    loadRows: async () => {
      const json = await fetchTreasuryAnnouncedJson({ signal: request.signal });
      const pressHtml = await fetchTreasuryPressReleasesHtml({ signal: request.signal });
      const rows = [...parseTreasuryAnnouncedJson(json), ...parseTreasuryPressListingHtml(pressHtml)];
      return rows;
    },
  });
}
