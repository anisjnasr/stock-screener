export type MarketEventCategory =
  | "fomc"
  | "fed_speech"
  | "fed_testimony"
  | "treasury_auction"
  | "treasury_press"
  | "pentagon_press"
  | "white_house"
  | "ustr"
  | "manual";

export type MarketImpact = "High" | "Medium" | "Low";

/** Row shape for upsert into `market_events`. */
export type MarketEventInsert = {
  event_date: string;
  event_time_et: string | null;
  event_title: string;
  event_category: MarketEventCategory;
  speaker: string | null;
  location: string | null;
  impact: MarketImpact;
  source_url: string | null;
  source_type: string;
  external_id: string | null;
  description: string | null;
  updated_at: string;
};

export type MarketEventPublic = {
  id: string;
  event_date: string;
  event_time_et: string | null;
  event_title: string;
  event_category: string;
  speaker: string | null;
  location: string | null;
  impact: string;
  source_url: string | null;
  source_type: string;
  description: string | null;
};

export type MarketEventsResponse = {
  events: MarketEventPublic[];
  range: { from: string; to: string };
};
