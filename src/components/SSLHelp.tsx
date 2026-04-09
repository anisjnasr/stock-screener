"use client";

type SSLHelpProps = {
  onClose: () => void;
};

export default function SSLHelp({ onClose }: SSLHelpProps) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ssl-help-title"
    >
      <div
        className="bg-white dark:bg-zinc-800 rounded-lg shadow-xl border border-zinc-200 dark:border-zinc-700 w-full max-w-2xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-3 border-b border-zinc-200 dark:border-zinc-700 shrink-0">
          <h2 id="ssl-help-title" className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 tracking-wide">
            StockStalker Scan Language (SSL)
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-400 dark:hover:text-zinc-200 shrink-0"
            aria-label="Close help"
          >
            <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
              <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8 2.146 2.854Z" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4 text-sm text-zinc-700 dark:text-zinc-300 space-y-5">
          <section>
            <p className="mb-2">
              SSL is the scan language used for custom screens. Each statement ends with a semicolon. Use{" "}
              <code className="font-mono">==</code> or <code className="font-mono">!=</code> for equality; <code className="font-mono">=</code> is
              only for assignment.
            </p>
            <div className="p-2 rounded border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 text-amber-900 dark:text-amber-200 text-xs">
              <strong>Snapshot data:</strong> Scans use stored daily bars and the screener snapshot (not live intraday).{" "}
              <code className="font-mono">C</code> is the latest stored close. <code className="font-mono">RS(1|3|6|12)</code> and{" "}
              <code className="font-mono">IndRank(1|3|6|12)</code> read precomputed fields.
            </div>
          </section>

          <section>
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-2">Structure</h3>
            <ul className="list-disc pl-5 space-y-1">
              <li>Optional assignments: <code className="font-mono">MA50 = MA(C, 50);</code></li>
              <li>Filter (required): boolean expression ending with <code className="font-mono">;</code></li>
              <li>
                Optional result shaping (last): <code className="font-mono">TopN(expr, 100);</code> or{" "}
                <code className="font-mono">SORT_BY = expr;</code> with <code className="font-mono">LIMIT = 50;</code>
              </li>
            </ul>
          </section>

          <section>
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-2">Price / snapshot identifiers</h3>
            <p className="mb-1">
              OHLCV: <code className="font-mono">Open</code>/<code className="font-mono">O</code>, <code className="font-mono">High</code>/
              <code className="font-mono">H</code>, <code className="font-mono">Low</code>/<code className="font-mono">L</code>,{" "}
              <code className="font-mono">Close</code>/<code className="font-mono">C</code>, <code className="font-mono">Volume</code>/
              <code className="font-mono">V</code>. Lookback: <code className="font-mono">C[1]</code>, <code className="font-mono">MA(C,20)[5]</code>.
            </p>
            <p>
              Examples: <code className="font-mono">MARKET_CAP</code>, <code className="font-mono">IPO_DATE</code>, <code className="font-mono">SECTOR</code>,{" "}
              <code className="font-mono">NAME</code> (ticker), <code className="font-mono">ADV</code> (50-day avg volume from bars).
            </p>
          </section>

          <section>
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-2">Functions</h3>
            <p>
              Rolling indicators on expressions: <code className="font-mono">MA</code>, <code className="font-mono">EMA</code>,{" "}
              <code className="font-mono">HHV</code>, <code className="font-mono">LLV</code>, <code className="font-mono">ROC</code>, etc. Element-wise:{" "}
              <code className="font-mono">MAX(a,b)</code>, <code className="font-mono">MIN(a,b)</code>. Also <code className="font-mono">Cross</code>,{" "}
              <code className="font-mono">Ref(C,-1)</code>, <code className="font-mono">RSI</code>, <code className="font-mono">ATR</code>,{" "}
              <code className="font-mono">IIf</code>, …
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
