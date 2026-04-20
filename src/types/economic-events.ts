/** Shape returned by GET /api/economic-events (public read fields). */
export type EconomicEventPublic = {
  id: string;
  event_date: string;
  event_time_et: string | null;
  event_name: string;
  country: string;
  impact: string;
  forecast: string | null;
  previous: string | null;
  actual: string | null;
};

export type EconomicEventsResponse = {
  events: EconomicEventPublic[];
  range: { from: string; to: string };
};
