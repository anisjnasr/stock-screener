import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import {
  getCompanyCalendarFields,
  getCompanyClassification,
  getCompanyName,
  getDailyBars,
  getFinancialsNative,
  getLatestScreenerDate,
  getOwnershipNative,
  getScreenerSnapshot,
} from "@/lib/screener-db-native";

export const runtime = "nodejs";

type ModelChoice = "sonnet" | "opus";
type ModelUsed = "sonnet" | "opus";
type LookbackUnit = "weeks" | "months" | "years";
type DataLookback = { value: number; unit: LookbackUnit } | null;
type CoverageReport = {
  needsWebFallback: boolean;
  missingOrStale: string[];
};
type WebTelemetry = {
  enabled: boolean;
  status: "not_requested" | "skipped" | "fetched" | "unavailable";
  reason: string | null;
  missingOrStale: string[];
  durationMs: number | null;
};
type AiCompletionCacheEntry = {
  modelUsed: ModelUsed;
  sourceTelemetry: WebTelemetry;
  text: string;
  cachedAtMs: number;
  expiresAtMs: number;
};
type AiCompletionCacheStats = {
  hits: number;
  misses: number;
};

type ReqBody = {
  prompt?: string;
  model?: ModelChoice;
  templateModel?: ModelChoice;
  symbol?: string;
  dataSources?: Array<"database" | "web">;
  dataLookback?: unknown;
};

function normalizeSymbol(input: unknown): string {
  const s = String(input ?? "").toUpperCase().trim();
  return /^[A-Z][A-Z0-9.\-]{0,9}$/.test(s) ? s : "";
}

function parseBody(raw: unknown): ReqBody {
  if (!raw || typeof raw !== "object") return {};
  return raw as ReqBody;
}

function parseDataLookback(raw: unknown): DataLookback {
  if (!raw) return null;
  // Backward-compatible support.
  if (raw === "1y") return { value: 1, unit: "years" };
  if (raw === "5y") return { value: 5, unit: "years" };
  if (typeof raw !== "object") return null;
  const value = Number((raw as { value?: unknown }).value);
  const unitRaw = (raw as { unit?: unknown }).unit;
  const unit: LookbackUnit | null =
    unitRaw === "weeks" || unitRaw === "months" || unitRaw === "years" ? unitRaw : null;
  if (!unit || !Number.isFinite(value) || value <= 0) return null;
  return { value: Math.max(1, Math.round(value)), unit };
}

function formatDataLookback(lookback: DataLookback): string {
  if (!lookback) return "default";
  return `${lookback.value} ${lookback.unit}`;
}

function chooseBarsLimit(lookback: DataLookback): number {
  if (!lookback) return 300;
  const perUnit = lookback.unit === "weeks" ? 5 : lookback.unit === "months" ? 21 : 252;
  const bars = lookback.value * perUnit;
  if (!Number.isFinite(bars)) return 300;
  // Safety bounds for DB fetch size.
  if (bars < 20) return 20;
  if (bars > 10000) return 10000;
  return Math.round(bars);
}

/** Oldest calendar date (UTC) included in the user's lookback window (inclusive). */
function lookbackToCutoffIso(lookback: DataLookback): string | null {
  if (!lookback) return null;
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (lookback.unit === "weeks") d.setUTCDate(d.getUTCDate() - 7 * lookback.value);
  else if (lookback.unit === "months") d.setUTCMonth(d.getUTCMonth() - lookback.value);
  else d.setUTCFullYear(d.getUTCFullYear() - lookback.value);
  return d.toISOString().slice(0, 10);
}

function buildLookbackWindowInstructions(lookback: DataLookback): string {
  if (!lookback) {
    return "No explicit lookback was set; use loaded bar depth as the practical history. If the user asks for events in a specific recent window, say when nothing in context falls in that window.";
  }
  const unit =
    lookback.unit === "weeks"
      ? lookback.value === 1
        ? "week"
        : "weeks"
      : lookback.unit === "months"
        ? lookback.value === 1
          ? "month"
          : "months"
        : lookback.value === 1
          ? "year"
          : "years";
  return `The user's lookback is approximately the last ${lookback.value} ${unit} from today (UTC). Only treat fundamentals, earnings dates, and commentary as "in window" when their dates fall on or after lookback.cutoffDate. If the prompt asks for earnings or events in that window and none appear in context, state clearly that none were found in the database for that period.`;
}

function filterFinancialRowsByCutoff<T extends { period_end: string }>(rows: T[], cutoff: string | null): T[] {
  if (!cutoff || rows.length === 0) return rows;
  return rows.filter((r) => String(r.period_end) >= cutoff);
}

const AI_CONTEXT_BARS_RECENT = 60;
const AI_CONTEXT_FINANCIALS_ANNUAL = 6;
const AI_CONTEXT_FINANCIALS_QUARTERLY = 8;
const AI_CONTEXT_OWNERSHIP_ROWS = 4;
const AI_COMPLETION_CACHE_TTL_MS = (() => {
  const raw = Number(process.env.AI_COMPLETION_CACHE_SECONDS ?? 600);
  if (!Number.isFinite(raw)) return 600_000;
  return Math.max(30, Math.round(raw)) * 1000;
})();

function getAiCompletionCache(): Map<string, AiCompletionCacheEntry> {
  const g = globalThis as typeof globalThis & {
    __aiCompletionCache?: Map<string, AiCompletionCacheEntry>;
  };
  if (!g.__aiCompletionCache) g.__aiCompletionCache = new Map<string, AiCompletionCacheEntry>();
  return g.__aiCompletionCache;
}

function getAiCompletionCacheStats(): AiCompletionCacheStats {
  const g = globalThis as typeof globalThis & {
    __aiCompletionCacheStats?: AiCompletionCacheStats;
  };
  if (!g.__aiCompletionCacheStats) g.__aiCompletionCacheStats = { hits: 0, misses: 0 };
  return g.__aiCompletionCacheStats;
}

function pruneAiCompletionCache(cache: Map<string, AiCompletionCacheEntry>, nowMs: number): void {
  for (const [k, v] of cache.entries()) {
    if (v.expiresAtMs <= nowMs) cache.delete(k);
  }
}

function buildAiCompletionCacheKey(input: {
  symbol: string;
  prompt: string;
  model: ModelChoice;
  dataSources: Array<"database" | "web">;
  dataLookback: DataLookback;
}): string {
  const normalizedSources = [...input.dataSources].sort();
  const lookback =
    input.dataLookback == null ? "default" : `${input.dataLookback.value}:${input.dataLookback.unit}`;
  return [
    input.symbol,
    input.model,
    normalizedSources.join(","),
    lookback,
    input.prompt.replace(/\s+/g, " ").trim(),
  ].join("|");
}

function compactBarsForPrompt(
  bars: Array<{ date: string; close: number; volume: number }>
): {
  count: number;
  startDate: string | null;
  endDate: string | null;
  lastClose: number | null;
  changePct20d: number | null;
  changePct60d: number | null;
  avgVolume20d: number | null;
  recent: Array<{ date: string; close: number; volume: number }>;
} {
  const count = bars.length;
  if (count === 0) {
    return {
      count: 0,
      startDate: null,
      endDate: null,
      lastClose: null,
      changePct20d: null,
      changePct60d: null,
      avgVolume20d: null,
      recent: [],
    };
  }
  const first = bars[0]!;
  const last = bars[count - 1]!;
  const close20 = count > 20 ? bars[count - 21]!.close : null;
  const close60 = count > 60 ? bars[count - 61]!.close : null;
  const changePct20d = close20 && close20 > 0 ? ((last.close - close20) / close20) * 100 : null;
  const changePct60d = close60 && close60 > 0 ? ((last.close - close60) / close60) * 100 : null;
  const vol20 = bars.slice(-20).map((b) => b.volume).filter((v) => Number.isFinite(v));
  const avgVolume20d = vol20.length > 0 ? vol20.reduce((a, b) => a + b, 0) / vol20.length : null;
  return {
    count,
    startDate: first.date,
    endDate: last.date,
    lastClose: Number.isFinite(last.close) ? last.close : null,
    changePct20d,
    changePct60d,
    avgVolume20d,
    recent: bars.slice(-AI_CONTEXT_BARS_RECENT).map((b) => ({
      date: b.date,
      close: b.close,
      volume: b.volume,
    })),
  };
}

function compactFinancialRowsForPrompt<T extends {
  period_end: string;
  eps?: number | null;
  sales?: number | null;
  eps_growth_yoy?: number | null;
  sales_growth_yoy?: number | null;
}>(rows: T[], maxRows: number): Array<{
  period_end: string;
  eps: number | null;
  sales: number | null;
  eps_growth_yoy: number | null;
  sales_growth_yoy: number | null;
}> {
  return rows.slice(0, maxRows).map((r) => ({
    period_end: r.period_end,
    eps: r.eps ?? null,
    sales: r.sales ?? null,
    eps_growth_yoy: r.eps_growth_yoy ?? null,
    sales_growth_yoy: r.sales_growth_yoy ?? null,
  }));
}

function jsonLine(obj: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(obj)}\n`);
}

function buildDatabaseContext(symbol: string, lookback: DataLookback): Record<string, unknown> {
  const asOfDate = getLatestScreenerDate() ?? "";
  const cutoff = lookbackToCutoffIso(lookback);
  const snapshot = getScreenerSnapshot({ symbols: [symbol], limit: 1, includeFinancialExtras: false }).rows[0] ?? null;
  const calendar = getCompanyCalendarFields(symbol);
  const company = {
    name: getCompanyName(symbol),
    classification: getCompanyClassification(symbol),
    calendar,
  };
  const annualRaw = getFinancialsNative(symbol, "annual", AI_CONTEXT_FINANCIALS_ANNUAL * 2);
  const quarterlyRaw = getFinancialsNative(symbol, "quarterly", AI_CONTEXT_FINANCIALS_QUARTERLY * 2);
  const financials = {
    annual: compactFinancialRowsForPrompt(
      filterFinancialRowsByCutoff(annualRaw, cutoff),
      AI_CONTEXT_FINANCIALS_ANNUAL
    ),
    quarterly: compactFinancialRowsForPrompt(
      filterFinancialRowsByCutoff(quarterlyRaw, cutoff),
      AI_CONTEXT_FINANCIALS_QUARTERLY
    ),
    filterNote:
      cutoff != null
        ? `Financial statement rows are filtered to period_end >= ${cutoff} (user lookback window).`
        : null,
  };
  const ownership = getOwnershipNative(symbol, AI_CONTEXT_OWNERSHIP_ROWS);
  const barsRaw = asOfDate ? getDailyBars(symbol, asOfDate, chooseBarsLimit(lookback)) : [];
  const bars = compactBarsForPrompt(
    barsRaw.map((b) => ({
      date: b.date,
      close: b.close,
      volume: b.volume,
    }))
  );
  let calendarNote: string | null = null;
  if (cutoff && calendar?.nextEarningsAt) {
    const inWindow = calendar.nextEarningsAt >= cutoff;
    calendarNote = inWindow
      ? `next_earnings_at (${calendar.nextEarningsAt}) is on or after lookback cutoff ${cutoff}.`
      : `next_earnings_at (${calendar.nextEarningsAt}) is before lookback cutoff ${cutoff} — not in the requested window for "recent" earnings.`;
  }
  return {
    asOfDate,
    lookback: {
      setting: lookback,
      cutoffDate: cutoff,
      instructions: buildLookbackWindowInstructions(lookback),
      calendarNote,
    },
    company,
    snapshot,
    financials,
    ownership,
    bars,
  };
}

function daysSinceDate(input: string): number | null {
  const t = Date.parse(input);
  if (!Number.isFinite(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
}

function assessDatabaseCoverage(database: Record<string, unknown> | undefined): CoverageReport {
  if (!database) {
    return { needsWebFallback: true, missingOrStale: ["database context unavailable"] };
  }
  const missingOrStale: string[] = [];
  const company = (database.company as Record<string, unknown> | undefined) ?? undefined;
  const financials = (database.financials as Record<string, unknown> | undefined) ?? undefined;
  const hasCompanyInfo = Boolean(company?.name || company?.classification);
  if (!hasCompanyInfo) missingOrStale.push("company profile");
  if (!database.snapshot) missingOrStale.push("snapshot metrics");
  const barsRecent = (database.bars as { recent?: unknown } | undefined)?.recent;
  if (!Array.isArray(barsRecent) || barsRecent.length === 0) missingOrStale.push("price/volume history");
  const annual = Array.isArray(financials?.annual) ? financials.annual : [];
  const quarterly = Array.isArray(financials?.quarterly) ? financials.quarterly : [];
  if (annual.length === 0 && quarterly.length === 0) missingOrStale.push("financial statements");
  if (!Array.isArray(database.ownership) || database.ownership.length === 0) missingOrStale.push("institutional ownership");
  const asOfDate = String(database.asOfDate ?? "");
  const ageDays = asOfDate ? daysSinceDate(asOfDate) : null;
  if (ageDays != null && ageDays > 5) {
    missingOrStale.push(`database snapshot stale (${ageDays} days old)`);
  }
  return { needsWebFallback: missingOrStale.length > 0, missingOrStale };
}

function pickFields<T extends Record<string, unknown>, K extends keyof T>(obj: T | null | undefined, keys: K[]): Partial<T> {
  if (!obj) return {};
  const out: Partial<T> = {};
  for (const key of keys) {
    const val = obj[key];
    if (val !== undefined && val !== null) out[key] = val;
  }
  return out;
}

async function fetchWebFallbackContext(symbol: string, lookback: DataLookback): Promise<Record<string, unknown>> {
  const YahooFinance = (await import("yahoo-finance2")).default as unknown as {
    quote: (ticker: string) => Promise<unknown>;
    quoteSummary: (ticker: string, opts: { modules: string[] }) => Promise<unknown>;
  };
  const safeCall = async <T>(fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch {
      return null;
    }
  };
  const timeoutMs = 4500;
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("web fallback timed out")), timeoutMs);
  });
  const task = (async () => {
    const [quoteRaw, summaryRaw] = await Promise.all([
      safeCall(() => YahooFinance.quote(symbol)),
      safeCall(() => YahooFinance.quoteSummary(symbol, {
        modules: [
          "summaryDetail",
          "financialData",
          "defaultKeyStatistics",
          "calendarEvents",
          "recommendationTrend",
          "assetProfile",
        ],
      })),
    ]);
    const quote = pickFields(
      (quoteRaw as Record<string, unknown> | null | undefined) ?? null,
      [
        "symbol",
        "shortName",
        "longName",
        "currency",
        "exchange",
        "regularMarketPrice",
        "regularMarketPreviousClose",
        "regularMarketOpen",
        "regularMarketDayHigh",
        "regularMarketDayLow",
        "regularMarketVolume",
        "averageDailyVolume3Month",
        "fiftyTwoWeekHigh",
        "fiftyTwoWeekLow",
        "marketCap",
        "trailingPE",
        "forwardPE",
      ]
    );
    const summary = (summaryRaw as Record<string, unknown> | null | undefined) ?? null;
    const cutoff = lookbackToCutoffIso(lookback);
    return {
      provider: "yahoo-finance2",
      fetchedAt: new Date().toISOString(),
      lookback: {
        cutoffDate: cutoff,
        note:
          cutoff != null
            ? `Interpret Yahoo calendar/earnings timestamps against the user's window: in-window only if the event date is on or after ${cutoff} (UTC date). If nothing falls in-window, say so.`
            : "No explicit lookback; use fetched timestamps as hints only.",
      },
      quote,
      summaryDetail: pickFields(
        (summary?.summaryDetail as Record<string, unknown> | undefined) ?? undefined,
        [
          "trailingPE",
          "forwardPE",
          "beta",
          "dividendYield",
          "payoutRatio",
          "priceToSalesTrailing12Months",
          "enterpriseToEbitda",
        ]
      ),
      financialData: pickFields(
        (summary?.financialData as Record<string, unknown> | undefined) ?? undefined,
        [
          "totalRevenue",
          "revenueGrowth",
          "grossMargins",
          "operatingMargins",
          "profitMargins",
          "returnOnEquity",
          "freeCashflow",
          "totalCash",
          "totalDebt",
        ]
      ),
      defaultKeyStatistics: pickFields(
        (summary?.defaultKeyStatistics as Record<string, unknown> | undefined) ?? undefined,
        ["enterpriseValue", "sharesOutstanding", "floatShares", "shortPercentOfFloat", "heldPercentInstitutions"]
      ),
      calendarEvents: pickFields(
        (summary?.calendarEvents as Record<string, unknown> | undefined) ?? undefined,
        ["earnings", "exDividendDate"]
      ),
      recommendationTrend: Array.isArray((summary?.recommendationTrend as Record<string, unknown> | undefined)?.trend)
        ? ((summary?.recommendationTrend as { trend?: unknown[] }).trend ?? []).slice(0, 4)
        : undefined,
      assetProfile: pickFields(
        (summary?.assetProfile as Record<string, unknown> | undefined) ?? undefined,
        ["sector", "industry", "website", "longBusinessSummary"]
      ),
    };
  })();
  return Promise.race([task, timeout]);
}

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Missing ANTHROPIC_API_KEY" }, { status: 500 });
  }

  const body = parseBody(await req.json().catch(() => ({})));
  const symbol = normalizeSymbol(body.symbol);
  const prompt = String(body.prompt ?? "").trim();
  if (!symbol || !prompt) {
    return NextResponse.json({ error: "symbol and prompt are required" }, { status: 400 });
  }
  const dataSources = Array.isArray(body.dataSources) ? body.dataSources : ["database"];
  const dataLookback = parseDataLookback(body.dataLookback);
  const requestedModel: ModelChoice =
    body.model === "opus" || body.model === "sonnet"
      ? body.model
      : body.templateModel === "opus" || body.templateModel === "sonnet"
        ? body.templateModel
        : "sonnet";
  const cacheKey = buildAiCompletionCacheKey({
    symbol,
    prompt,
    model: requestedModel,
    dataSources,
    dataLookback,
  });
  const cache = getAiCompletionCache();
  const cacheStats = getAiCompletionCacheStats();
  const nowMs = Date.now();
  pruneAiCompletionCache(cache, nowMs);
  const cached = cache.get(cacheKey);

  if (cached && cached.expiresAtMs > nowMs) {
    cacheStats.hits += 1;
    const total = cacheStats.hits + cacheStats.misses;
    const hitRate = total > 0 ? Math.round((cacheStats.hits / total) * 100) : 0;
    console.info(
      "[ai-completion] cache-hit",
      JSON.stringify({ symbol, model: requestedModel, hits: cacheStats.hits, misses: cacheStats.misses, hitRatePct: hitRate })
    );
    const cachedStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(jsonLine({ type: "meta", modelUsed: cached.modelUsed, cached: true }));
        controller.enqueue(
          jsonLine({
            type: "meta",
            modelUsed: cached.modelUsed,
            sourceTelemetry: cached.sourceTelemetry,
            cached: true,
          })
        );
        if (cached.text) controller.enqueue(jsonLine({ type: "delta", text: cached.text }));
        controller.enqueue(jsonLine({ type: "done", cached: true }));
        controller.close();
      },
    });
    return new Response(cachedStream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }
  cacheStats.misses += 1;

  const anthropic = new Anthropic({ apiKey });

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      (async () => {
        try {
          const runStartedAt = Date.now();
          const modelUsed: ModelUsed = requestedModel;

          const modelName = modelUsed === "opus" ? "claude-opus-4-20250514" : "claude-sonnet-4-20250514";
          controller.enqueue(jsonLine({ type: "meta", modelUsed }));

          const hasDb = dataSources.includes("database");
          const hasWeb = dataSources.includes("web");

          const context: Record<string, unknown> = { symbol, dataSources, dataLookback };
          const webTelemetry: WebTelemetry = {
            enabled: hasWeb,
            status: "not_requested",
            reason: null,
            missingOrStale: [],
            durationMs: null,
          };

          let databaseContext: Record<string, unknown> | undefined;
          if (hasDb) {
            databaseContext = buildDatabaseContext(symbol, dataLookback);
            context.database = databaseContext;
          }

          const coverage = assessDatabaseCoverage(hasDb ? databaseContext : undefined);
          if (hasDb) webTelemetry.missingOrStale = coverage.missingOrStale;

          if (hasWeb && hasDb) {
            const supplementReason =
              coverage.missingOrStale.length > 0
                ? `Yahoo supplement for DB gaps/staleness: ${coverage.missingOrStale.join(", ")}`
                : "Yahoo market snapshot to complement database (database is authoritative for overlapping fields).";
            const webFetchStartedAt = Date.now();
            try {
              context.web = {
                ...(await fetchWebFallbackContext(symbol, dataLookback)),
                sourceRole: "supplement_after_database",
                fallbackReason: supplementReason,
              };
              webTelemetry.status = "fetched";
              webTelemetry.reason = supplementReason;
              webTelemetry.durationMs = Date.now() - webFetchStartedAt;
            } catch (error) {
              context.web = {
                provider: "yahoo-finance2",
                status: "unavailable",
                error: error instanceof Error ? error.message : "web fetch failed",
                fallbackReason: supplementReason,
              };
              webTelemetry.status = "unavailable";
              webTelemetry.reason = supplementReason;
              webTelemetry.durationMs = Date.now() - webFetchStartedAt;
            }
          } else if (hasWeb && !hasDb) {
            context.web = {
              mode: "anthropic_web_search",
              note: "Database is disabled. Use the web_search tool to retrieve timely public information. If nothing relevant is found for the user's lookback window, say so.",
            };
            webTelemetry.status = "fetched";
            webTelemetry.reason = "Claude web_search tool (database off)";
          }

          controller.enqueue(jsonLine({ type: "meta", modelUsed, sourceTelemetry: webTelemetry }));
          console.info(
            "[ai-completion] source-resolution",
            JSON.stringify({
              symbol,
              modelUsed,
              dataSources,
              webTelemetry,
            })
          );

          const system = [
            "You are an equity research assistant.",
            "Use provided context first. If context is missing, say so explicitly instead of fabricating values.",
            "Respect context.database.lookback: only treat fundamentals and events as “in window” when their dates are on or after lookback.cutoffDate when a cutoff is present.",
            "When both database and supplemental web (Yahoo) contexts exist, treat database as authoritative for overlapping numeric/historical fields; use web to fill gaps or fresher market-facing fields and label the web source.",
            "If web values are used, call out that source explicitly.",
            "Be concise, structured, and include key risks/assumptions.",
            "Follow the user's requested format and length exactly when specified.",
            "Default writing style when not specified: 1 short paragraph of 3-4 sentences.",
            "Formatting contract by default: use markdown.",
            "Use ## section headers for multi-part answers when helpful.",
            "Use numbered lists for ordered reasons/steps and bullet lists for unordered points.",
            "When comparing 2+ items or metrics, prefer a clean markdown table.",
            "Whenever quoting figures or statistics, include a source link in markdown format like [Source](https://...).",
            "End investment-style analyses with a bolded Key Risk line when relevant.",
            "Never repeat sentences, clauses, or phrases.",
            "Do not emit draft alternatives; provide one final answer only.",
            "Avoid filler intros/outros; use plain, direct language.",
          ].join(" ");

          const user = [
            `Symbol: ${symbol}`,
            `Data sources: ${dataSources.join(", ")}`,
            `Data lookback: ${formatDataLookback(dataLookback)}`,
            "",
            "Context JSON:",
            JSON.stringify(context, null, 2),
            "",
            "User prompt:",
            prompt,
          ].filter(Boolean).join("\n");

          const streamBase = {
            model: modelName,
            max_tokens: 1400,
            temperature: 0.2,
            system,
            messages: [{ role: "user" as const, content: user }],
          };
          let aiText = "";
          const emitDelta = (text: string): void => {
            if (!text) return;
            aiText += text;
            controller.enqueue(jsonLine({ type: "delta", text }));
          };

          if (hasWeb && !hasDb) {
            try {
              const msgStream = anthropic.messages.stream({
                ...streamBase,
                tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 10 }],
                tool_choice: { type: "auto" },
              });
              for await (const event of msgStream) {
                if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
                  emitDelta(event.delta.text);
                }
              }
            } catch {
              const msgStream = anthropic.messages.stream(streamBase);
              for await (const event of msgStream) {
                if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
                  emitDelta(event.delta.text);
                }
              }
            }
          } else {
            const msgStream = anthropic.messages.stream(streamBase);
            for await (const event of msgStream) {
              if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
                emitDelta(event.delta.text);
              }
            }
          }
          cache.set(cacheKey, {
            modelUsed,
            sourceTelemetry: webTelemetry,
            text: aiText,
            cachedAtMs: Date.now(),
            expiresAtMs: Date.now() + AI_COMPLETION_CACHE_TTL_MS,
          });
          console.info(
            "[ai-completion] completed",
            JSON.stringify({
              symbol,
              modelUsed,
              elapsedMs: Date.now() - runStartedAt,
              webStatus: webTelemetry.status,
              webDurationMs: webTelemetry.durationMs,
              cached: false,
              cacheHits: cacheStats.hits,
              cacheMisses: cacheStats.misses,
              cacheHitRatePct:
                cacheStats.hits + cacheStats.misses > 0
                  ? Math.round((cacheStats.hits / (cacheStats.hits + cacheStats.misses)) * 100)
                  : 0,
            })
          );
          controller.enqueue(jsonLine({ type: "done" }));
          controller.close();
        } catch (error) {
          const message = error instanceof Error ? error.message : "AI completion failed";
          controller.enqueue(jsonLine({ type: "error", error: message }));
          controller.close();
        }
      })();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
