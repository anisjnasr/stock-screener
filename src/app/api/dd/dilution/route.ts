import { NextRequest, NextResponse } from "next/server";
import { computeOverhang, extractDilution } from "@/lib/dd/dilution";
import {
  fetchFilingText,
  fetchRecentFilings,
  latestFilingDate as pickLatestFilingDate,
  selectFilingsForExtraction,
  type DDFilingText,
} from "@/lib/dd/edgar";
import { fetchDDNews } from "@/lib/dd/news";
import { buildMetrics, normalizeTicker } from "@/lib/dd/metrics";
import { getCachedDilution, getOverride, upsertDilutionReport } from "@/lib/dd/store";
import { computeVerdict } from "@/lib/dd/verdict";
import type { DDInstrument, DDMetrics, DDOverhangBreakdown, DDReport } from "@/lib/dd/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Per-document text cap; total budget is enforced again inside dilution.ts. */
const PER_DOC_CHARS = 40_000;

function hasReverseSplit12mo(metrics: DDMetrics): boolean {
  return metrics.splits.some((s) => s.is_reverse);
}

/**
 * GET /api/dd/dilution?ticker=XYZ — phase-2 dilution extraction (spec §6).
 * Cache check first on (ticker, latest_filing_date); otherwise run AI extraction,
 * compute overhang + verdict, persist status='complete' (or 'error' on parse failure).
 */
export async function GET(request: NextRequest) {
  const ticker = normalizeTicker(request.nextUrl.searchParams.get("ticker"));
  if (!ticker) {
    return NextResponse.json({ ok: false, error: "Invalid or missing ticker" }, { status: 400 });
  }

  let override = null;
  const ov = await getOverride(ticker);
  if (ov.ok) override = ov.data;

  // Build phase-1 metrics + news (needed for verdict + a self-contained cached report).
  const [metricsResult, news] = await Promise.all([
    buildMetrics(ticker, override, request.signal),
    fetchDDNews(ticker, request.signal).catch(() => []),
  ]);

  if (!metricsResult.found) {
    return NextResponse.json({ ok: true, ticker, found: false });
  }
  const metrics = metricsResult.metrics;
  const paddedCik = metricsResult.cik;

  const buildReport = (
    status: DDReport["status"],
    instruments: DDInstrument[],
    overhang: DDOverhangBreakdown | null,
    notes: string[],
    latestFilingDate: string | null,
    error?: string
  ): DDReport => {
    const verdict = computeVerdict({
      runway_months: metrics.runway_months,
      cash_flow_positive: metrics.cash_flow_positive,
      float: metrics.float,
      overhang_pct: overhang?.overhang_pct ?? null,
      instruments,
      has_reverse_split_12mo: hasReverseSplit12mo(metrics),
    });
    return {
      ticker,
      status,
      latest_filing_date: latestFilingDate,
      generated_at: new Date().toISOString(),
      metrics,
      news,
      instruments,
      overhang,
      notes,
      verdict,
      error,
    };
  };

  // No SEC coverage → return a complete report with no dilution data (spec §10).
  if (!paddedCik) {
    const report = buildReport("complete", [], null, ["Limited SEC coverage — dilution not extracted"], null);
    return NextResponse.json({ ok: true, ticker, found: true, report });
  }

  const filings = await fetchRecentFilings(paddedCik, request.signal);
  const filingDate = pickLatestFilingDate(filings);
  if (!filingDate) {
    const report = buildReport("complete", [], null, ["No SEC filings found"], null);
    return NextResponse.json({ ok: true, ticker, found: true, report });
  }

  // Cache check (spec §9): reuse when a report for this exact filing date already exists.
  const cached = await getCachedDilution(ticker, filingDate);
  if (cached.ok && cached.data && cached.data.status === "complete") {
    const report = buildReport(
      "complete",
      cached.data.instruments,
      cached.data.overhang,
      cached.data.notes,
      filingDate
    );
    // Prefer cached news only if the live fetch returned nothing.
    if (report.news.length === 0) report.news = cached.data.news;
    return NextResponse.json({ ok: true, ticker, found: true, report, cache_hit: true });
  }

  // Run extraction.
  try {
    const selected = selectFilingsForExtraction(filings);
    const texts: DDFilingText[] = [];
    for (const f of selected) {
      const t = await fetchFilingText(paddedCik, f, PER_DOC_CHARS, request.signal);
      if (t) texts.push(t);
    }

    const extraction = await extractDilution(texts, request.signal);
    const { instruments, overhang } = computeOverhang(
      extraction.instruments,
      metrics.shares_outstanding,
      metrics.price
    );

    const report = buildReport("complete", instruments, overhang, extraction.notes, filingDate);

    await upsertDilutionReport({
      ticker,
      latest_filing_date: filingDate,
      status: "complete",
      metrics,
      news,
      instruments,
      overhang,
      notes: extraction.notes,
      verdict: report.verdict,
    }).catch(() => undefined);

    return NextResponse.json({ ok: true, ticker, found: true, report });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const report = buildReport("error", [], null, [], filingDate, msg);
    await upsertDilutionReport({
      ticker,
      latest_filing_date: filingDate,
      status: "error",
      metrics,
      news,
      instruments: [],
      overhang: null,
      notes: [],
      verdict: report.verdict,
    }).catch(() => undefined);
    return NextResponse.json({ ok: true, ticker, found: true, report });
  }
}
