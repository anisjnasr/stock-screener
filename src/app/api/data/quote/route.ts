import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { adaptQuote } from "@/lib/data-adapter";

const FINNHUB_KEY = process.env.FINNHUB_API_KEY;
const BASE = "https://finnhub.io/api/v1";

export async function GET(req: NextRequest) {
  const err = requireApiKey(req);
  if (err) return err;
  const symbol = req.nextUrl.searchParams.get("symbol");
  if (!symbol) {
    return NextResponse.json({ error: "Missing symbol" }, { status: 400 });
  }
  if (!FINNHUB_KEY) {
    return NextResponse.json({ error: "Missing FINNHUB_API_KEY" }, { status: 500 });
  }
  try {
    const res = await fetch(
      `${BASE}/quote?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_KEY}`,
      { next: { revalidate: 60 } }
    );
    const data = (await res.json()) as Record<string, unknown>;
    if (data.c == null && data.d == null) {
      return NextResponse.json(
        { error: "Data not available for this symbol" },
        { status: 404 }
      );
    }
    const quote = adaptQuote(data, symbol);
    return NextResponse.json(quote);
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Failed to fetch quote" },
      { status: 502 }
    );
  }
}
