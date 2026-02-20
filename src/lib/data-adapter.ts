import type {
  Quote,
  CompanyProfile,
  Fundamentals,
  NewsItem,
  ShortStats,
  InstitutionalStats,
  SearchResult,
} from "./types";

// Finnhub quote response
export function adaptQuote(data: Record<string, unknown>, symbol: string): Quote {
  const c = Number(data.c ?? data.currentPrice ?? 0);
  const pc = Number(data.pc ?? data.previousClose ?? c);
  const change = c - pc;
  const changePercent = pc ? (change / pc) * 100 : 0;
  return {
    symbol,
    price: c,
    change,
    changePercent,
    high: data.h != null ? Number(data.h) : undefined,
    low: data.l != null ? Number(data.l) : undefined,
    open: data.o != null ? Number(data.o) : undefined,
    previousClose: pc,
  };
}

// Finnhub company profile
export function adaptProfile(data: Record<string, unknown>, symbol: string): CompanyProfile {
  return {
    name: String(data.name ?? ""),
    symbol,
    website: data.weburl ? String(data.weburl) : undefined,
    employees: data.employeeTotal != null ? Number(data.employeeTotal) : undefined,
    address: data.address ? String(data.address) : undefined,
    industry: data.finnhubIndustry ? String(data.finnhubIndustry) : undefined,
    sector: data.finnhubIndustry ? String(data.finnhubIndustry) : undefined,
    description: data.description ? String(data.description) : undefined,
  };
}

// Finnhub company basic financials / overview
export function adaptFundamentals(data: Record<string, unknown>, symbol: string): Fundamentals {
  const metric = (data.metric ?? data) as Record<string, unknown>;
  return {
    symbol,
    marketCap: metric.marketCapitalization != null ? Number(metric.marketCapitalization) : undefined,
    float: metric.shareOutstanding != null ? Number(metric.shareOutstanding) : undefined,
    earningsDate: metric.epsAnnual ? undefined : undefined,
    pe: metric.peBasicAnnual != null ? Number(metric.peBasicAnnual) : undefined,
    eps: metric.epsBasicAnnual != null ? Number(metric.epsBasicAnnual) : undefined,
  };
}

// Finnhub company earnings
export function getNextEarningsDate(events: unknown[]): string | undefined {
  const next = Array.isArray(events)
    ? events.find((e: unknown) => (e as Record<string, unknown>).actualDate === null)
    : null;
  const date = next ? (next as Record<string, unknown>).date : null;
  return date ? String(date) : undefined;
}

// Finnhub news
export function adaptNewsItem(item: Record<string, unknown>): NewsItem {
  return {
    id: String(item.id ?? item.headline ?? Math.random()),
    headline: String(item.headline ?? ""),
    summary: item.summary ? String(item.summary) : undefined,
    url: String(item.url ?? "#"),
    source: String(item.source ?? ""),
    time: String(item.datetime ?? item.created ?? ""),
    relatedSymbols: Array.isArray(item.related) ? (item.related as string[]) : undefined,
  };
}

// Stub for short stats (free tier often doesn't have)
export function stubShortStats(symbol: string): ShortStats {
  return {
    symbol,
    shortPercentFloat: null,
    daysToCover: null,
    note: "Short interest data not available on free tier. Upgrade data plan for this metric.",
  };
}

// Stub for institutional
export function stubInstitutionalStats(symbol: string): InstitutionalStats {
  return {
    symbol,
    ownershipPercent: null,
    numberOfFunds: null,
    qoqChange: null,
    trend: null,
    note: "Institutional ownership data not available on free tier. Upgrade for funds count and QoQ trends.",
  };
}

// Finnhub symbol search
export function adaptSearchResult(item: Record<string, unknown>): SearchResult {
  return {
    symbol: String(item.symbol ?? ""),
    description: String(item.description ?? item.displaySymbol ?? ""),
    type: item.type ? String(item.type) : undefined,
  };
}
