import type { NextRequest } from "next/server";
import { runMarketEventIngest } from "@/lib/sources/ingestMarketEventsShared";
import { fetchWhiteHousePostsSitemapXml, parseWhiteHousePostsSitemapXml } from "@/lib/sources/whiteHouseSitemap";

/**
 * White House briefing / presidential actions from WP posts sitemap.
 * POST — Bearer CRON_SECRET.
 */
export async function POST(request: NextRequest) {
  return runMarketEventIngest(request, {
    source: "white_house",
    loadRows: async () => {
      const xml = await fetchWhiteHousePostsSitemapXml({ signal: request.signal });
      return parseWhiteHousePostsSitemapXml(xml);
    },
  });
}
