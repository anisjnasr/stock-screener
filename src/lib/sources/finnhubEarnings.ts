import type { EarningsCalendarInsert, ReportTimeBucket } from "@/types/earnings-calendar";

const UA = "StockStalker/1.0 (earnings calendar; contact: local)";

function getFinnhubKey(): string {
  const k = process.env.FINNHUB_API_KEY?.trim();
  if (!k) throw new Error("FINNHUB_API_KEY is not set");
  return k;
}

function parseNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Map Finnhub `hour` to our bucket (defaults to dmh). */
export function normalizeReportTime(raw: unknown): ReportTimeBucket | null {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (s === "bmo" || s.includes("before")) return "bmo";
  if (s === "amc" || s.includes("after")) return "amc";
  if (s === "dmh" || s === "dmt" || s.includes("during")) return "dmh";
  return "dmh";
}

export function surprisePct(actual: number | null, est: number | null): number | null {
  if (actual == null || est == null) return null;
  if (!Number.isFinite(actual) || !Number.isFinite(est)) return null;
  const ae = Math.abs(est);
  if (ae < 1e-9) return null;
  return ((actual - est) / ae) * 100;
}

/** Calendar quarter (1–4) and year from `YYYY-MM-DD`. */
export function quarterYearFromDate(ymd: string): { quarter: number; year: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return { quarter: 1, year: new Date().getUTCFullYear() };
  const year = Number(m[1]);
  const month = Number(m[2]);
  const q = Math.floor((month - 1) / 3) + 1;
  return { quarter: q, year };
}

export function prevQuarter(q: number, y: number): { quarter: number; year: number } {
  if (q > 1) return { quarter: q - 1, year: y };
  return { quarter: 4, year: y - 1 };
}

export type FinnhubEarningsRaw = {
  date?: string;
  symbol?: string;
  epsEstimate?: unknown;
  epsActual?: unknown;
  revenueEstimate?: unknown;
  revenueActual?: unknown;
  hour?: unknown;
  quarter?: unknown;
  year?: unknown;
  name?: string;
};

/**
 * Fetch Finnhub `calendar/earnings` for [from, to] inclusive (YYYY-MM-DD).
 */
export async function fetchFinnhubEarningsCalendar(
  fromYmd: string,
  toYmd: string,
  init?: { signal?: AbortSignal }
): Promise<FinnhubEarningsRaw[]> {
  const token = getFinnhubKey();
  const u = new URL("https://finnhub.io/api/v1/calendar/earnings");
  u.searchParams.set("from", fromYmd);
  u.searchParams.set("to", toYmd);
  u.searchParams.set("token", token);
  const res = await fetch(u.toString(), {
    signal: init?.signal,
    headers: { Accept: "application/json", "User-Agent": UA },
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Finnhub earnings HTTP ${res.status}: ${text.slice(0, 200)}`);
  let data: { earningsCalendar?: FinnhubEarningsRaw[] };
  try {
    data = JSON.parse(text) as { earningsCalendar?: FinnhubEarningsRaw[] };
  } catch {
    throw new Error("Finnhub earnings: invalid JSON");
  }
  return Array.isArray(data.earningsCalendar) ? data.earningsCalendar : [];
}

function rowRichness(row: EarningsCalendarInsert): number {
  let s = 0;
  if (row.report_time != null) s += 2;
  if (row.eps_actual != null) s += 4;
  if (row.revenue_actual != null) s += 4;
  if (row.eps_estimate != null) s += 1;
  if (row.revenue_estimate != null) s += 1;
  if (row.company_name) s += 1;
  return s;
}

/**
 * Map Finnhub rows to insert rows (no prior-quarter fields yet).
 */
export function mapFinnhubToInserts(raw: FinnhubEarningsRaw[], allowed: Set<string>): EarningsCalendarInsert[] {
  const now = new Date().toISOString();
  const byKey = new Map<string, EarningsCalendarInsert>();
  for (const r of raw) {
    const ticker = String(r.symbol ?? "")
      .trim()
      .toUpperCase();
    const report_date = String(r.date ?? "").trim().slice(0, 10);
    if (!ticker || !/^\d{4}-\d{2}-\d{2}$/.test(report_date)) continue;
    if (!allowed.has(ticker)) continue;

    let quarter = parseNum(r.quarter) != null ? Math.round(Number(r.quarter)) : null;
    let year = parseNum(r.year) != null ? Math.round(Number(r.year)) : null;
    if (quarter == null || year == null || quarter < 1 || quarter > 4) {
      const d = quarterYearFromDate(report_date);
      quarter = d.quarter;
      year = d.year;
    }

    const eps_estimate = parseNum(r.epsEstimate);
    const eps_actual = parseNum(r.epsActual);
    const revenue_estimate = parseNum(r.revenueEstimate);
    const revenue_actual = parseNum(r.revenueActual);

    const row: EarningsCalendarInsert = {
      ticker,
      company_name: r.name != null ? String(r.name).trim() || null : null,
      report_date,
      report_time: normalizeReportTime(r.hour),
      quarter,
      year,
      eps_estimate,
      revenue_estimate,
      eps_actual,
      revenue_actual,
      current_quarter_eps_surprise_pct: surprisePct(eps_actual, eps_estimate),
      current_quarter_rev_surprise_pct: surprisePct(revenue_actual, revenue_estimate),
      prior_quarter_eps_surprise_pct: null,
      prior_quarter_rev_surprise_pct: null,
      last_updated_at: now,
    };
    const k = `${ticker}|${report_date}|${quarter}|${year}`;
    const prev = byKey.get(k);
    if (!prev || rowRichness(row) >= rowRichness(prev)) {
      byKey.set(k, row);
    }
  }
  return [...byKey.values()];
}
