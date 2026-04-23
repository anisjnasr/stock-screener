/**
 * One-off: SIP candidate counts from TradingView (no LLM).
 * Run: npx tsx --env-file=.env.local scripts/sip-qualify-diagnostic.ts
 * Or:  npx tsx scripts/sip-qualify-diagnostic.ts
 */
import { normalizeGappersScanBody, loadGappersSipScan } from "../src/lib/premarket/gappers-ingest";
import { isSipVolumeCandidate, SIP_MIN_ABS_GAP_PCT, SIP_MIN_PM_VOLUME, SIP_MIN_PM_VOL_FRAC_OF_ADV } from "../src/lib/premarket/sip-candidate-filter";
import type { GapperRow } from "../src/types/gappers";
import { TRADINGVIEW_GAP_SCAN_ROW_CAP } from "../src/lib/sources/tradingViewScreener";

function sipScanFromBody(body: unknown) {
  const n = normalizeGappersScanBody(body);
  return {
    ...n,
    minPrice: Math.max(3, n.minPrice),
    minMarketCap: Math.max(250_000_000, n.minMarketCap),
    minGapPct: Math.max(2, n.minGapPct),
  };
}

function failReason(r: Pick<GapperRow, "gapPct" | "pmVolume" | "avgVolume90d">): string {
  if (!Number.isFinite(r.gapPct) || Math.abs(r.gapPct) < SIP_MIN_ABS_GAP_PCT) return "gap";
  if (!Number.isFinite(r.pmVolume) || r.pmVolume < SIP_MIN_PM_VOLUME) return "pm_vol_low";
  const adv = r.avgVolume90d;
  if (adv == null || !Number.isFinite(adv) || adv <= 0) return "no_adv";
  if (r.pmVolume < adv * SIP_MIN_PM_VOL_FRAC_OF_ADV) return "pm_vs_adv";
  return "ok";
}

async function main() {
  const scan = sipScanFromBody({});
  console.log("SIP scan params:", JSON.stringify(scan, null, 2));
  const { rows } = await loadGappersSipScan(scan, { rowLimit: TRADINGVIEW_GAP_SCAN_ROW_CAP, minAbsGapPct: 2 });
  console.log(`\nRaw rows from bidirectional TV scan: ${rows.length}`);

  const volOk = rows.filter(isSipVolumeCandidate);
  console.log(`Volume-qualified (|gap|≥${SIP_MIN_ABS_GAP_PCT}%, PM≥${SIP_MIN_PM_VOLUME}, PM≥${SIP_MIN_PM_VOL_FRAC_OF_ADV * 100}% of 90d ADV): ${volOk.length}`);

  const reasons = new Map<string, number>();
  for (const r of rows) {
    const k = failReason(r);
    reasons.set(k, (reasons.get(k) ?? 0) + 1);
  }
  console.log("\nFailure breakdown (raw rows):");
  for (const [k, v] of [...reasons.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`);
  }

  const top = [...rows]
    .sort((a, b) => Math.abs(b.gapPct) - Math.abs(a.gapPct))
    .slice(0, 8);
  console.log("\nTop |gap| raw samples:");
  for (const r of top) {
    const adv = r.avgVolume90d;
    const pct = adv && adv > 0 ? ((r.pmVolume / adv) * 100).toFixed(1) : "—";
    console.log(
      `  ${r.ticker} gap=${r.gapPct.toFixed(2)}% pmVol=${Math.round(r.pmVolume)} adv90=${adv != null ? Math.round(adv) : "null"} pm/adv=${pct}% → ${failReason(r)}`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
