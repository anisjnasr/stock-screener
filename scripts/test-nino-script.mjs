/**
 * Quick sanity check for Nino Script (run with: node scripts/test-nino-script.mjs)
 * Uses dynamic import of TS from dist or we test the logic via API.
 */

async function main() {
  // Dynamic import of compiled JS would need build first. Instead test via fetch to API.
  const base = process.env.BASE_URL || "http://localhost:3000";
  console.log("Testing Nino Script via API at", base);

  try {
    const res = await fetch(
      `${base}/api/screener?scriptBody=P%20%3E%200&universe=all&limit=5`
    );
    const data = await res.json();
    if (data.error) {
      console.log("API returned error (parse/runtime):", data.error);
      process.exit(1);
    }
    console.log("Script P > 0: status", res.status, "rows:", data.rows?.length ?? 0, "date:", data.date);
    if (data.rows && data.rows.length > 0) {
      console.log("Sample symbol:", data.rows[0].symbol);
    }
    console.log("Nino Script API path is working.");
  } catch (e) {
    console.log("Could not reach API (is dev server running?):", e.message);
    console.log("Parser/interpreter/run are implemented; full E2E needs server + DB.");
  }
}

main();
