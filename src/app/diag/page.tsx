"use client";
import { useEffect, useState } from "react";

export default function DiagPage() {
  const [results, setResults] = useState<string[]>(["Starting diagnostics..."]);

  const log = (msg: string) => setResults((prev) => [...prev, msg]);

  useEffect(() => {
    (async () => {
      try {
        log("1. Fetching /api/candles?symbol=SPY&interval=daily ...");
        const t0 = Date.now();
        const res = await fetch("/api/candles?symbol=SPY&interval=daily");
        const elapsed = Date.now() - t0;
        log(`   Status: ${res.status} (${elapsed}ms)`);
        const text = await res.text();
        log(`   Response length: ${text.length} chars`);
        let data;
        try {
          data = JSON.parse(text);
        } catch (e: unknown) {
          log(`   JSON parse error: ${e instanceof Error ? e.message : e}`);
          return;
        }
        log(`   Is array: ${Array.isArray(data)}, length: ${Array.isArray(data) ? data.length : "N/A"}`);
        if (Array.isArray(data) && data.length > 0) {
          log(`   First item: ${JSON.stringify(data[0])}`);
          log(`   Last item: ${JSON.stringify(data[data.length - 1])}`);
        }

        log("2. Testing lightweight-charts import...");
        try {
          const lc = await import("lightweight-charts");
          log(`   Module keys: ${Object.keys(lc).join(", ")}`);
          log(`   createChart type: ${typeof lc.createChart}`);
          log(`   CandlestickSeries: ${typeof lc.CandlestickSeries}`);
        } catch (e: unknown) {
          log(`   IMPORT ERROR: ${e instanceof Error ? e.message : e}`);
          return;
        }

        log("3. Testing chart creation...");
        try {
          const { createChart, CandlestickSeries } = await import("lightweight-charts");
          const container = document.createElement("div");
          container.style.width = "400px";
          container.style.height = "300px";
          document.body.appendChild(container);
          const chart = createChart(container, { width: 400, height: 300 });
          log(`   Chart created successfully: ${typeof chart}`);
          const series = chart.addSeries(CandlestickSeries);
          log(`   Series created: ${typeof series}`);
          if (Array.isArray(data) && data.length > 0) {
            const testData = data.slice(0, 10).map((d: { date: string; open: number; high: number; low: number; close: number }) => ({
              time: d.date,
              open: d.open,
              high: d.high,
              low: d.low,
              close: d.close,
            }));
            series.setData(testData);
            log(`   Data set successfully (${testData.length} bars)`);
          }
          chart.remove();
          container.remove();
          log("   Chart test PASSED");
        } catch (e: unknown) {
          log(`   CHART ERROR: ${e instanceof Error ? `${e.message}\n${e.stack}` : e}`);
        }

        log("4. Checking for global errors...");
        log("   All tests complete.");
      } catch (e: unknown) {
        log(`FATAL: ${e instanceof Error ? `${e.message}\n${e.stack}` : e}`);
      }
    })();
  }, []);

  return (
    <div style={{ padding: 20, fontFamily: "monospace", fontSize: 13, background: "#111", color: "#0f0", minHeight: "100vh" }}>
      <h1 style={{ color: "#fff" }}>Chart Diagnostics</h1>
      <pre style={{ whiteSpace: "pre-wrap" }}>
        {results.join("\n")}
      </pre>
    </div>
  );
}
