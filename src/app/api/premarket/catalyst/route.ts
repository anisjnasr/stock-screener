import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { generateSipCatalystMap } from "@/lib/ai/sipCatalyst";
import type { GapperRow } from "@/types/gappers";
import type { PythonNewsItem } from "@/lib/python-service";
import type { SipCatalystDetailRequest, SipCatalystDetailResponse } from "@/types/stocks-in-play";

export const runtime = "nodejs";

function normalizeGapperRow(raw: unknown): GapperRow | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const ticker = String(o.ticker ?? "").trim().toUpperCase();
  if (!ticker) return null;
  return {
    ticker,
    compositeSymbol: o.compositeSymbol != null ? String(o.compositeSymbol) : null,
    companyName: o.companyName != null ? String(o.companyName) : null,
    lastPrice: Number(o.lastPrice ?? 0),
    gapPct: Number(o.gapPct ?? 0),
    pmVolume: Number(o.pmVolume ?? 0),
    dayVolume: o.dayVolume == null ? null : Number(o.dayVolume),
    avgVolume90d: o.avgVolume90d == null ? null : Number(o.avgVolume90d),
    volPct: o.volPct == null ? null : Number(o.volPct),
    marketCap: o.marketCap == null ? null : Number(o.marketCap),
    sector: o.sector != null ? String(o.sector) : null,
    industry: o.industry != null ? String(o.industry) : null,
    exchange: o.exchange != null ? String(o.exchange) : null,
    earningsRecent24h: Boolean(o.earningsRecent24h),
  };
}

function normalizeHeadlines(raw: unknown): PythonNewsItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const o = item as Record<string, unknown>;
      const title = String(o.title ?? "").trim();
      if (!title) return null;
      return {
        title,
        publisher: o.publisher != null ? String(o.publisher) : null,
        published_at: typeof o.published_at === "number" ? o.published_at : null,
        link: o.link != null ? String(o.link) : null,
        type: o.type != null ? String(o.type) : null,
      } satisfies PythonNewsItem;
    })
    .filter((row): row is PythonNewsItem => Boolean(row))
    .slice(0, 12);
}

export async function POST(request: Request): Promise<Response> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: "ANTHROPIC_API_KEY is not set" } satisfies SipCatalystDetailResponse,
      { status: 503 }
    );
  }

  const raw = (await request.json().catch(() => ({}))) as Partial<SipCatalystDetailRequest>;
  const row = normalizeGapperRow(raw.row);
  if (!row) {
    return NextResponse.json(
      { ok: false, error: "Missing or invalid ticker row payload" } satisfies SipCatalystDetailResponse,
      { status: 400 }
    );
  }

  const headlines = normalizeHeadlines(raw.headlines);
  if (headlines.length === 0) {
    return NextResponse.json({ ok: true, ticker: row.ticker, catalyst: null } satisfies SipCatalystDetailResponse);
  }

  const themesSummary = typeof raw.themesSummary === "string" ? raw.themesSummary.trim() : "";

  try {
    const anthropic = new Anthropic({ apiKey });
    const { catalystByTicker } = await generateSipCatalystMap(
      anthropic,
      [row],
      { [row.ticker]: headlines },
      themesSummary
    );
    return NextResponse.json({
      ok: true,
      ticker: row.ticker,
      catalyst: catalystByTicker[row.ticker] ?? null,
    } satisfies SipCatalystDetailResponse);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Catalyst generation failed",
      } satisfies SipCatalystDetailResponse,
      { status: 500 }
    );
  }
}
