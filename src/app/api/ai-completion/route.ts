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

type ModelChoice = "auto" | "sonnet" | "opus";
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

async function promptLikelyNeedsWebOnlySources(anthropic: Anthropic, prompt: string): Promise<boolean> {
  const resp = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 5,
    temperature: 0,
    system:
      "Answer with exactly YES or NO. Does the prompt require breaking news, press releases, social/real-time web sentiment, or other information that is NOT covered by a typical local stock database (OHLC bars, fundamentals, ownership, company profile)?",
    messages: [{ role: "user", content: prompt.slice(0, 8000) }],
  });
  const text = resp.content
    .map((c) => ("text" in c ? c.text : ""))
    .join("")
    .trim()
    .toUpperCase();
  return text.startsWith("YES");
}

function jsonLine(obj: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(obj)}\n`);
}

async function classifyModel(anthropic: Anthropic, prompt: string): Promise<ModelUsed> {
  const resp = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 8,
    temperature: 0,
    system:
      "Classify whether this prompt requires complex multi-step reasoning, nuanced judgment, or synthesis across many data points. Respond with only 'opus' or 'sonnet'.",
    messages: [{ role: "user", content: prompt }],
  });
  const text = resp.content
    .map((c) => ("text" in c ? c.text : ""))
    .join("")
    .trim()
    .toLowerCase();
  return text.includes("opus") ? "opus" : "sonnet";
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
  const annualRaw = getFinancialsNative(symbol, "annual", 16);
  const quarterlyRaw = getFinancialsNative(symbol, "quarterly", 24);
  const financials = {
    annual: filterFinancialRowsByCutoff(annualRaw, cutoff),
    quarterly: filterFinancialRowsByCutoff(quarterlyRaw, cutoff),
    filterNote:
      cutoff != null
        ? `Financial statement rows are filtered to period_end >= ${cutoff} (user lookback window).`
        : null,
  };
  const ownership = getOwnershipNative(symbol, 8);
  const bars = asOfDate ? getDailyBars(symbol, asOfDate, chooseBarsLimit(lookback)) : [];
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
  if (!Array.isArray(database.bars) || database.bars.length === 0) missingOrStale.push("price/volume history");
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
    body.model === "opus" || body.model === "sonnet" || body.model === "auto"
      ? body.model
      : body.templateModel === "opus" || body.templateModel === "sonnet" || body.templateModel === "auto"
        ? body.templateModel
        : "auto";

  const anthropic = new Anthropic({ apiKey });

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      (async () => {
        try {
          const runStartedAt = Date.now();
          let modelUsed: ModelUsed;
          if (requestedModel === "auto") {
            modelUsed = await classifyModel(anthropic, prompt);
          } else {
            modelUsed = requestedModel;
          }

          const modelName = modelUsed === "opus" ? "claude-opus-4-20250514" : "claude-sonnet-4-20250514";
          controller.enqueue(jsonLine({ type: "meta", modelUsed }));

          const hasDb = dataSources.includes("database");
          const hasWeb = dataSources.includes("web");

          if (hasDb && !hasWeb) {
            const needsWeb = await promptLikelyNeedsWebOnlySources(anthropic, prompt);
            if (needsWeb) {
              controller.enqueue(
                jsonLine({
                  type: "warning",
                  code: "web_recommended",
                  message:
                    "This prompt likely needs current web or news sources, but only **Database** is enabled. Enable **Web** in the insight data sources, or rephrase to use only fields present in the database context below.",
                })
              );
            }
          }

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
            max_tokens: 2800,
            temperature: 0.2,
            system,
            messages: [{ role: "user" as const, content: user }],
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
                  controller.enqueue(jsonLine({ type: "delta", text: event.delta.text }));
                }
              }
            } catch {
              const msgStream = anthropic.messages.stream(streamBase);
              for await (const event of msgStream) {
                if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
                  controller.enqueue(jsonLine({ type: "delta", text: event.delta.text }));
                }
              }
            }
          } else {
            const msgStream = anthropic.messages.stream(streamBase);
            for await (const event of msgStream) {
              if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
                controller.enqueue(jsonLine({ type: "delta", text: event.delta.text }));
              }
            }
          }
          console.info(
            "[ai-completion] completed",
            JSON.stringify({
              symbol,
              modelUsed,
              elapsedMs: Date.now() - runStartedAt,
              webStatus: webTelemetry.status,
              webDurationMs: webTelemetry.durationMs,
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
