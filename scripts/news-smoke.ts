/** POST /news for one ticker: npx tsx --env-file=.env.local scripts/news-smoke.ts CPIX */
import { fetchPythonTickerNews, isPythonServiceConfigured } from "../src/lib/python-service";

const ticker = (process.argv[2] ?? "CPIX").trim().toUpperCase();

async function main() {
  if (!isPythonServiceConfigured()) {
    console.error("PYTHON_SERVICE_URL / PYTHON_SERVICE_KEY not set");
    process.exit(1);
  }
  const { data } = await fetchPythonTickerNews({ tickers: [ticker], hoursBack: 24 });
  const items = data[ticker] ?? [];
  console.log(`${ticker}: ${items.length} headline(s) (last 24h)`);
  for (let i = 0; i < Math.min(10, items.length); i++) {
    const h = items[i]!;
    console.log(`  ${i + 1}. ${h.title ?? "—"}`);
    if (h.publisher) console.log(`     publisher: ${h.publisher}`);
    if (h.link) console.log(`     ${h.link}`);
    if (h.published_at != null) console.log(`     published_at: ${h.published_at}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
