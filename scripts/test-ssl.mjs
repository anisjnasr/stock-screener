/**
 * Quick sanity check for SSL via screener API (run with: node scripts/test-ssl.mjs)
 */
const base = process.env.BASE_URL || "http://127.0.0.1:3000";

async function main() {
  console.log("Testing SSL via API at", base);
  const url = `${base}/api/screener?scriptBody=${encodeURIComponent("C > 0;")}&universe=all&limit=5`;
  const res = await fetch(url);
  const text = await res.text();
  console.log("status", res.status);
  try {
    const j = JSON.parse(text);
    console.log("keys", Object.keys(j));
    if (j.error) console.log("script error:", j.error);
    else console.log("SSL API path responded OK.");
  } catch {
    console.log("body", text.slice(0, 500));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
