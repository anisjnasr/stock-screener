import type { GapperRow, GapperSource } from "./gappers";
import type { SipCatalyst } from "./sip-catalyst";
import type { PythonNewsItem } from "@/lib/python-service";

/** POST `/api/premarket/stocks-in-play` success payload. */
export type StocksInPlaySuccess = {
  ok: true;
  source: GapperSource;
  rows: GapperRow[];
  pythonConfigured: boolean;
  news: Record<string, PythonNewsItem[]> | null;
  newsError?: string | null;
  /** Phase 12B–C: LLM catalyst per ticker; null if no key or no rows */
  catalyst: Record<string, SipCatalyst> | null;
  catalystError?: string | null;
  /** True when `ANTHROPIC_API_KEY` is not set (headlines may still work). */
  catalystSkipped?: boolean;
};
