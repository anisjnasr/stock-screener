import type { GapperRow, GapperSource } from "./gappers";
import type { SipCatalyst } from "./sip-catalyst";
import type { PythonNewsItem } from "@/lib/python-service";
import type { SipPersistVariant } from "@/lib/premarket/sip-daily-persistence";

/** POST `/api/premarket/stocks-in-play` success payload. */
export type StocksInPlaySuccess = {
  ok: true;
  source: GapperSource;
  rows: GapperRow[];
  pythonConfigured: boolean;
  /** Headline-first catalyst signal source for the grid (refreshed in batch). */
  news: Record<string, PythonNewsItem[]> | null;
  newsError?: string | null;
  /** Detailed LLM catalyst details, generated on demand per ticker. */
  catalyst: Record<string, SipCatalyst> | null;
  catalystError?: string | null;
  /** True only when on-demand catalyst generation is explicitly skipped server-side. */
  catalystSkipped?: boolean;
};

export type SipCatalystDetailRequest = {
  row: GapperRow;
  headlines: PythonNewsItem[];
  themesSummary?: string;
};

export type SipCatalystDetailResponse =
  | { ok: true; ticker: string; catalyst: SipCatalyst | null }
  | { ok: false; error: string };

export type CuratedSipAddPayload = {
  row: GapperRow;
  headlines: PythonNewsItem[];
  catalyst: SipCatalyst | null;
  target: SipPersistVariant;
};
