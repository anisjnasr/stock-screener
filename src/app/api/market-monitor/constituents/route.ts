import { NextResponse } from "next/server";
import { getMarketMonitorConstituents, isMarketMonitorMetricKey } from "@/lib/screener-db-native";
import { recordPerf } from "@/lib/perf-monitor";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  const _perfStart = performance.now();
  try {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get("date") ?? "";
    const metric = searchParams.get("metric") ?? "";

    if (!DATE_RE.test(date)) {
      return NextResponse.json({ error: "Invalid or missing date (YYYY-MM-DD)" }, { status: 400 });
    }
    if (!isMarketMonitorMetricKey(metric)) {
      return NextResponse.json({ error: "Invalid metric" }, { status: 400 });
    }

    const stocks = getMarketMonitorConstituents(date, metric);
    recordPerf("api", "/api/market-monitor/constituents", Math.round(performance.now() - _perfStart), {
      meta: { count: stocks.length },
    });
    return NextResponse.json({ stocks, count: stocks.length, date, metric });
  } catch (e) {
    recordPerf("api", "/api/market-monitor/constituents", Math.round(performance.now() - _perfStart), { status: 500 });
    const message = e instanceof Error ? e.message : "Market monitor constituents error";
    return NextResponse.json({ error: message, stocks: [] }, { status: 500 });
  }
}
