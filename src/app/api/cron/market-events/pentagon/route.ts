import type { NextRequest } from "next/server";
import { runMarketEventIngest } from "@/lib/sources/ingestMarketEventsShared";
import { fetchPentagonAdvisoriesRss, parsePentagonAdvisoriesRss } from "@/lib/sources/pentagonAdvisories";

/**
 * Pentagon advisories RSS (press briefings / conferences).
 * POST — Bearer CRON_SECRET.
 */
export async function POST(request: NextRequest) {
  return runMarketEventIngest(request, {
    source: "pentagon",
    loadRows: async () => {
      const xml = await fetchPentagonAdvisoriesRss({ signal: request.signal });
      return parsePentagonAdvisoriesRss(xml);
    },
  });
}
