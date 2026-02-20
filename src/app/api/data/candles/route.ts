import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";

const FINNHUB_KEY = process.env.FINNHUB_API_KEY;
const BASE = "https://finnhub.io/api/v1";

export async function GET(req: NextRequest) {
  const err = requireApiKey(req);
  if (err) return err;
  const symbol = req.nextUrl.searchParams.get("symbol");
  const resolution = req.nextUrl.searchParams.get("resolution") ?? "D";
  if (!symbol) {
    return NextResponse.json({ error: "Missing symbol" }, { status: 400 });
  }
  if (!FINNHUB_KEY) {
    return NextResponse.json({ error: "Missing FINNHUB_API_KEY" }, { status: 500 });
  }
  const to = Math.floor(Date.now() / 1000);
  const from = to - 365 * 24 * 60 * 60;
  try {
    const res = await fetch(
      `${BASE}/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=${resolution}&from=${from}&to=${to}&token=${FINNHUB_KEY}`,
      { next: { revalidate: 300 } }
    );
    const data = (await res.json()) as { t?: number[]; o?: number[]; h?: number[]; l?: number[]; c?: number[]; v?: number[] };
    const result = {
      t: data.t ?? [],
      o: data.o ?? [],
      h: data.h ?? [],
      l: data.l ?? [],
      c: data.c ?? [],
      v: data.v ?? [],
    };
    return NextResponse.json(result);
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Failed to fetch candles" },
      { status: 502 }
    );
  }
}
