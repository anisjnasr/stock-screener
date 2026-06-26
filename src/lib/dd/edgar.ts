/**
 * SEC EDGAR client for the Small-Cap DD panel.
 *
 * EDGAR rules (apply to every data.sec.gov / sec.gov request):
 *  - Send a User-Agent like "StockStalker you@email" (EDGAR rejects requests without it).
 *  - Rate limit <= 10 requests/sec.
 *  - CIK must be zero-padded to 10 digits, or you get HTTP 500.
 */

const USER_AGENT =
  process.env.EDGAR_USER_AGENT?.trim() ||
  process.env.SEC_USER_AGENT?.trim() ||
  "StockStalker contact@example.com";

/** Forms that carry dilution-relevant terms (spec §6.2). */
export const DD_RELEVANT_FORMS = new Set<string>([
  "424B5",
  "424B3",
  "424B4",
  "S-1",
  "S-3",
  "8-K",
  "10-Q",
  "10-K",
  "DEF 14A",
  "EFFECT",
]);

/** Forms that carry live offering terms — prioritized first when capping. */
const DD_PRIORITY_FORMS = new Set<string>(["424B5", "S-3", "8-K"]);

export function padCik(cik: string | number): string {
  const digits = String(cik).replace(/\D/g, "");
  return digits.padStart(10, "0");
}

// --- simple <=10 req/s throttle (shared across the process) ---
let lastRequestMs = 0;
const MIN_GAP_MS = 110; // ~9 req/s, safely under the 10/s ceiling

async function throttle(): Promise<void> {
  const now = Date.now();
  const wait = Math.max(0, lastRequestMs + MIN_GAP_MS - now);
  lastRequestMs = now + wait;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

const FETCH_TIMEOUT_MS = 20_000;

async function edgarFetch(url: string, signal?: AbortSignal): Promise<Response | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    await throttle();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    if (signal) {
      if (signal.aborted) ctrl.abort();
      else signal.addEventListener("abort", () => ctrl.abort(), { once: true });
    }
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        cache: "no-store",
        headers: { "User-Agent": USER_AGENT, Accept: "application/json, text/html" },
      });
      clearTimeout(timer);
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
        continue;
      }
      return res;
    } catch {
      clearTimeout(timer);
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
    }
  }
  return null;
}

/** Map ticker → CIK via the SEC master file (fallback when Polygon lacks cik). */
export async function resolveCikFromTicker(ticker: string, signal?: AbortSignal): Promise<string | null> {
  const res = await edgarFetch("https://www.sec.gov/files/company_tickers.json", signal);
  if (!res || !res.ok) return null;
  try {
    const data = (await res.json()) as Record<string, { ticker?: string; cik_str?: number }>;
    const upper = ticker.toUpperCase();
    for (const row of Object.values(data)) {
      if (row.ticker?.toUpperCase() === upper && row.cik_str != null) return padCik(row.cik_str);
    }
  } catch {
    /* fall through */
  }
  return null;
}

export type XbrlUsdEntry = {
  start?: string;
  end: string;
  val: number;
  form?: string;
  fy?: number;
  fp?: string;
};

async function fetchCompanyConcept(
  paddedCik: string,
  concept: string,
  signal?: AbortSignal
): Promise<XbrlUsdEntry[] | null> {
  const res = await edgarFetch(
    `https://data.sec.gov/api/xbrl/companyconcept/CIK${paddedCik}/us-gaap/${concept}.json`,
    signal
  );
  if (!res || !res.ok) return null;
  try {
    const data = (await res.json()) as { units?: { USD?: XbrlUsdEntry[] } };
    const usd = data.units?.USD;
    return Array.isArray(usd) ? usd.filter((e) => typeof e.val === "number" && e.end) : null;
  } catch {
    return null;
  }
}

/** §5.4 — most recent cash & equivalents, with its "as of" end date. */
export async function fetchCashOnHand(
  paddedCik: string,
  signal?: AbortSignal
): Promise<{ value: number; asOf: string } | null> {
  const entries = await fetchCompanyConcept(paddedCik, "CashAndCashEquivalentsAtCarryingValue", signal);
  if (!entries || entries.length === 0) return null;
  let best: XbrlUsdEntry | null = null;
  for (const e of entries) {
    if (!best || e.end > best.end) best = e;
  }
  return best ? { value: best.val, asOf: best.end } : null;
}

/** Raw operating cash-flow XBRL entries (for the TTM rollforward in runway.ts). */
export async function fetchOperatingCashFlowEntries(
  paddedCik: string,
  signal?: AbortSignal
): Promise<XbrlUsdEntry[] | null> {
  return fetchCompanyConcept(paddedCik, "NetCashProvidedByUsedInOperatingActivities", signal);
}

export type EdgarFiling = {
  form: string;
  filingDate: string;
  accessionNumber: string;
  primaryDocument: string;
};

/** §6.2 — recent relevant filings from the submissions API (parallel arrays). */
export async function fetchRecentFilings(
  paddedCik: string,
  signal?: AbortSignal
): Promise<EdgarFiling[]> {
  const res = await edgarFetch(`https://data.sec.gov/submissions/CIK${paddedCik}.json`, signal);
  if (!res || !res.ok) return [];
  try {
    const data = (await res.json()) as {
      filings?: {
        recent?: {
          form?: string[];
          filingDate?: string[];
          accessionNumber?: string[];
          primaryDocument?: string[];
        };
      };
    };
    const recent = data.filings?.recent;
    if (!recent?.form) return [];
    const out: EdgarFiling[] = [];
    for (let i = 0; i < recent.form.length; i++) {
      out.push({
        form: recent.form[i] ?? "",
        filingDate: recent.filingDate?.[i] ?? "",
        accessionNumber: recent.accessionNumber?.[i] ?? "",
        primaryDocument: recent.primaryDocument?.[i] ?? "",
      });
    }
    return out;
  } catch {
    return [];
  }
}

/** The most recent filing date across all filings (the dd_reports cache key). */
export function latestFilingDate(filings: EdgarFiling[]): string | null {
  let latest: string | null = null;
  for (const f of filings) {
    if (f.filingDate && (!latest || f.filingDate > latest)) latest = f.filingDate;
  }
  return latest;
}

/**
 * Select the most recent ~`cap` relevant filings, prioritizing live-offering forms
 * (424B5 / S-3 / 8-K) so token budget covers the highest-signal documents.
 */
export function selectFilingsForExtraction(filings: EdgarFiling[], cap = 15): EdgarFiling[] {
  const relevant = filings.filter((f) => DD_RELEVANT_FORMS.has(f.form));
  relevant.sort((a, b) => b.filingDate.localeCompare(a.filingDate));
  const priority = relevant.filter((f) => DD_PRIORITY_FORMS.has(f.form));
  const rest = relevant.filter((f) => !DD_PRIORITY_FORMS.has(f.form));
  const seen = new Set<string>();
  const out: EdgarFiling[] = [];
  for (const f of [...priority, ...rest]) {
    const key = f.accessionNumber || `${f.form}-${f.filingDate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
    if (out.length >= cap) break;
  }
  return out;
}

function buildDocumentUrl(paddedCik: string, filing: EdgarFiling): string | null {
  if (!filing.accessionNumber || !filing.primaryDocument) return null;
  const cikNoZeros = String(Number(paddedCik));
  const accNoDashes = filing.accessionNumber.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${cikNoZeros}/${accNoDashes}/${filing.primaryDocument}`;
}

/** Strip HTML to readable text and collapse whitespace. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type DDFilingText = {
  form: string;
  filingDate: string;
  source: string; // e.g. "424B5 2026-04-02"
  text: string;
};

/** Fetch + strip a filing's primary document, truncated per-document. */
export async function fetchFilingText(
  paddedCik: string,
  filing: EdgarFiling,
  maxChars: number,
  signal?: AbortSignal
): Promise<DDFilingText | null> {
  const url = buildDocumentUrl(paddedCik, filing);
  if (!url) return null;
  const res = await edgarFetch(url, signal);
  if (!res || !res.ok) return null;
  const raw = await res.text();
  const text = htmlToText(raw).slice(0, maxChars);
  if (!text) return null;
  return {
    form: filing.form,
    filingDate: filing.filingDate,
    source: `${filing.form} ${filing.filingDate}`,
    text,
  };
}
