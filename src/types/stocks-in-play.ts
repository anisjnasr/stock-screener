import type { GapperRow, GapperSource } from "./gappers";
import type { PythonNewsItem } from "@/lib/python-service";

/** POST `/api/premarket/stocks-in-play` success payload. */
export type StocksInPlaySuccess = {
  ok: true;
  source: GapperSource;
  rows: GapperRow[];
  pythonConfigured: boolean;
  news: Record<string, PythonNewsItem[]> | null;
  newsError?: string | null;
};
