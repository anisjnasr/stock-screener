/** POST /news for AAPL via same client as Next.js. */
import { fetchPythonTickerNews, isPythonServiceConfigured } from "../src/lib/python-service";

async function main() {
  if (!isPythonServiceConfigured()) {
    console.error("PYTHON_SERVICE_URL / PYTHON_SERVICE_KEY not set");
    process.exit(1);
  }
  const { data } = await fetchPythonTickerNews({ tickers: ["AAPL"], hoursBack: 24 });
  const items = data.AAPL ?? [];
  console.log(`AAPL: ${items.length} headline(s)`);
  for (let i = 0; i < Math.min(3, items.length); i++) {
    const h = items[i]!;
    console.log(`  ${i + 1}. ${h.title?.slice(0, 120) ?? "—"}`);
    if (h.link) console.log(`     ${h.link}`);
    if (h.published_at != null) console.log(`     published_at: ${h.published_at}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
