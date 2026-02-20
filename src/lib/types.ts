export interface Quote {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  high?: number;
  low?: number;
  open?: number;
  previousClose?: number;
}

export interface CompanyProfile {
  name: string;
  symbol: string;
  website?: string;
  employees?: number;
  address?: string;
  industry?: string;
  sector?: string;
  description?: string;
}

export interface Fundamentals {
  symbol: string;
  marketCap?: number;
  float?: number;
  earningsDate?: string;
  nextEarningsDate?: string;
  pe?: number;
  eps?: number;
}

export interface NewsItem {
  id: string;
  headline: string;
  summary?: string;
  url: string;
  source: string;
  time: string;
  relatedSymbols?: string[];
}

export interface ShortStats {
  symbol: string;
  shortPercentFloat?: number | null;
  daysToCover?: number | null;
  note?: string;
}

export interface InstitutionalStats {
  symbol: string;
  ownershipPercent?: number | null;
  numberOfFunds?: number | null;
  qoqChange?: number | null;
  trend?: string | null;
  note?: string;
}

export interface SearchResult {
  symbol: string;
  description: string;
  type?: string;
}

export interface Watchlist {
  id: string;
  name: string;
  created_at: string;
  items?: WatchlistItem[];
}

export interface WatchlistItem {
  id: string;
  watchlist_id: string;
  symbol: string;
  added_at: string;
}

export interface PositionList {
  id: string;
  name: string;
  created_at: string;
  items?: PositionItem[];
}

export interface PositionItem {
  id: string;
  position_list_id: string;
  symbol: string;
  quantity?: number;
  entry_price?: number;
  added_at: string;
}

export interface SavedPrompt {
  id: string;
  title: string;
  prompt_text: string;
  created_at: string;
}

export type WidgetType = "indices" | "chart" | "watchlist" | "positions" | "news";

export interface DashboardWidget {
  id: string;
  type: WidgetType;
  config: Record<string, unknown>;
}
