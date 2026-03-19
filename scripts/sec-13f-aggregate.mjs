/**
 * Aggregate parsed 13F holdings by (symbol, report_date): num_funds and top 5 by value.
 */

/**
 * Aggregate holdings (with symbol resolved) into per-symbol, per-reportDate stats.
 * Input: iterable of { symbol, reportDate, accessionNumber, filerName, value, shares }.
 * Output: Map<reportDate, Map<symbol, { num_funds, top_holders }>>.
 */
export function aggregateHoldings(holdingsWithSymbol) {
  const byReport = new Map();
  for (const h of holdingsWithSymbol) {
    const { symbol, reportDate, accessionNumber, filerName, value, shares } = h;
    if (!symbol || !reportDate) continue;
    if (!byReport.has(reportDate)) {
      byReport.set(reportDate, new Map());
    }
    const bySymbol = byReport.get(reportDate);
    if (!bySymbol.has(symbol)) {
      bySymbol.set(symbol, {
        filerValues: new Map(),
        filerSet: new Set(),
      });
    }
    const rec = bySymbol.get(symbol);
    rec.filerSet.add(accessionNumber || filerName);
    const val = value != null ? value : 0;
    const key = accessionNumber || filerName;
    const existing = rec.filerValues.get(key) || { name: filerName, value: 0, shares: 0 };
    existing.value += val;
    existing.shares = (existing.shares || 0) + (shares || 0);
    rec.filerValues.set(key, existing);
  }
  const result = new Map();
  for (const [reportDate, bySymbol] of byReport) {
    const symbolMap = new Map();
    for (const [symbol, rec] of bySymbol) {
      const num_funds = rec.filerSet.size;
      const sorted = [...rec.filerValues.entries()]
        .sort((a, b) => (b[1].value || 0) - (a[1].value || 0))
        .slice(0, 5)
        .map(([, v]) => ({
          name: v.name || "",
          value: v.value,
          shares: v.shares || null,
        }));
      symbolMap.set(symbol, { num_funds, top_holders: sorted });
    }
    result.set(reportDate, symbolMap);
  }
  return result;
}

/**
 * Compute num_funds_change for each (symbol, report_date) given ordered report dates (oldest first).
 */
export function addNumFundsChange(byReportDate, reportDatesOrdered) {
  const out = [];
  for (let i = 0; i < reportDatesOrdered.length; i++) {
    const reportDate = reportDatesOrdered[i];
    const bySymbol = byReportDate.get(reportDate);
    if (!bySymbol) continue;
    const prevDate = i > 0 ? reportDatesOrdered[i - 1] : null;
    const prevBySymbol = prevDate ? byReportDate.get(prevDate) : null;
    for (const [symbol, rec] of bySymbol) {
      const prevNum = prevBySymbol?.get(symbol)?.num_funds ?? null;
      const change =
        prevNum != null && rec.num_funds != null ? rec.num_funds - prevNum : null;
      out.push({
        symbol,
        report_date: reportDate,
        num_funds: rec.num_funds,
        num_funds_change: change,
        top_holders: rec.top_holders,
      });
    }
  }
  return out;
}
