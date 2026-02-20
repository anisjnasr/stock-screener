import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { adaptNewsItem } from "@/lib/data-adapter";

const FINNHUB_KEY = process.env.FINNHUB_API_KEY;
const BASE = "https://finnhub.io/api/v1";

export async function GET(req: NextRequest) {
  const err = requireApiKey(req);
  if (err) return err;
  const symbol = req.nextUrl.searchParams.get("symbol");
  const category = req.nextUrl.searchParams.get("category") ?? "general";
  if (!FINNHUB_KEY) {
    return NextResponse.json({ error: "Missing FINNHUB_API_KEY" }, { status: 500 });
  }
  try {
    const from = new Date();
    from.setDate(from.getDate() - 7);
    const to = new Date();
    const fromStr = from.toISOString().slice(0, 10);
    const toStr = to.toISOString().slice(0, 10);
    const url = symbol
      ? `${BASE}/company-news?symbol=${encodeURIComponent(symbol)}&from=${fromStr}&to=${toStr}&token=${FINNHUB_KEY}`
      : `${BASE}/news?category=${encodeURIComponent(category)}&token=${FINNHUB_KEY}`;
    const res = await fetch(url, { next: { revalidate: 300 } });
    const raw = (await res.json()) as unknown[];
    const list = Array.isArray(raw) ? raw.slice(0, 20).map((item) => adaptNewsItem(item as Record<string, unknown>)) : [];
    return NextResponse.json(list);
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Failed to fetch news" },
      { status: 502 }
    );
  }
}
