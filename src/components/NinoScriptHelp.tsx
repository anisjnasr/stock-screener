"use client";

type NinoScriptHelpProps = {
  onClose: () => void;
};

export default function NinoScriptHelp({ onClose }: NinoScriptHelpProps) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="nino-script-help-title"
    >
      <div
        className="bg-white dark:bg-zinc-800 rounded-lg shadow-xl border border-zinc-200 dark:border-zinc-700 w-full max-w-2xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-3 border-b border-zinc-200 dark:border-zinc-700 shrink-0">
          <h2 id="nino-script-help-title" className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 uppercase tracking-wide">
            Nino Script Help
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
        <div className="flex-1 overflow-auto p-4 text-sm text-zinc-700 dark:text-zinc-300 space-y-6">
          <section>
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-2">What is Nino Script?</h3>
            <p className="mb-2">
              Nino Script is a simple expression language for custom scans. You write a condition (and optional variable assignments) that is evaluated for each stock using its historical daily OHLCV data. Stocks that make the condition true appear in your scan results.
            </p>
            <p>
              <strong>Syntax:</strong> You can write a single boolean expression, or one or more assignments followed by an expression. Use a semicolon <code className="px-1 py-0.5 rounded bg-zinc-200 dark:bg-zinc-700 font-mono text-xs">;</code> to separate statements. The last expression is the scan condition.
            </p>
          </section>

          <section>
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-2">Punctuation</h3>
            <ul className="list-disc pl-5 space-y-1">
              <li><code className="px-1 py-0.5 rounded bg-zinc-200 dark:bg-zinc-700 font-mono">( )</code> — Parentheses for grouping and function arguments.</li>
              <li><code className="px-1 py-0.5 rounded bg-zinc-200 dark:bg-zinc-700 font-mono">[ ]</code> — Brackets for lookback: <code className="font-mono">P[1]</code> means close 1 bar ago.</li>
              <li><code className="px-1 py-0.5 rounded bg-zinc-200 dark:bg-zinc-700 font-mono">,</code> — Comma to separate function arguments, e.g. <code className="font-mono">MA(C, 50)</code>.</li>
              <li><code className="px-1 py-0.5 rounded bg-zinc-200 dark:bg-zinc-700 font-mono">;</code> — Semicolon to separate statements, e.g. <code className="font-mono">X = MA(C, 50); P &gt; X</code>.</li>
            </ul>
          </section>

          <section>
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-2">Price &amp; Volume Variables</h3>
            <p className="mb-2">Use these identifiers to reference the current bar (or a past bar with lookback). <strong>P and C both mean Close price;</strong> use either one.</p>
            <table className="w-full border border-zinc-200 dark:border-zinc-600 rounded overflow-hidden text-left">
              <thead>
                <tr className="bg-zinc-100 dark:bg-zinc-700">
                  <th className="px-2 py-1.5 font-medium">Variable</th>
                  <th className="px-2 py-1.5 font-medium">Meaning</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-zinc-200 dark:border-zinc-600"><td className="px-2 py-1.5 font-mono">P</td><td>Close price</td></tr>
                <tr className="border-t border-zinc-200 dark:border-zinc-600"><td className="px-2 py-1.5 font-mono">C</td><td>Close price (same as P)</td></tr>
                <tr className="border-t border-zinc-200 dark:border-zinc-600"><td className="px-2 py-1.5 font-mono">O</td><td>Open price</td></tr>
                <tr className="border-t border-zinc-200 dark:border-zinc-600"><td className="px-2 py-1.5 font-mono">H</td><td>High price</td></tr>
                <tr className="border-t border-zinc-200 dark:border-zinc-600"><td className="px-2 py-1.5 font-mono">L</td><td>Low price</td></tr>
                <tr className="border-t border-zinc-200 dark:border-zinc-600"><td className="px-2 py-1.5 font-mono">V</td><td>Volume</td></tr>
              </tbody>
            </table>
            <p className="mt-2">
              <strong>Lookback (bars ago):</strong> <code className="font-mono">P[1]</code> = close 1 bar ago (yesterday), <code className="font-mono">H[5]</code> = high 5 bars ago, etc.
            </p>
          </section>

          <section>
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-2">Comparison Operators</h3>
            <table className="w-full border border-zinc-200 dark:border-zinc-600 rounded overflow-hidden text-left">
              <thead>
                <tr className="bg-zinc-100 dark:bg-zinc-700">
                  <th className="px-2 py-1.5 font-medium">Operator</th>
                  <th className="px-2 py-1.5 font-medium">Meaning</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-zinc-200 dark:border-zinc-600"><td className="px-2 py-1.5 font-mono">&gt;</td><td>Greater than</td></tr>
                <tr className="border-t border-zinc-200 dark:border-zinc-600"><td className="px-2 py-1.5 font-mono">&lt;</td><td>Less than</td></tr>
                <tr className="border-t border-zinc-200 dark:border-zinc-600"><td className="px-2 py-1.5 font-mono">&gt;=</td><td>Greater than or equal</td></tr>
                <tr className="border-t border-zinc-200 dark:border-zinc-600"><td className="px-2 py-1.5 font-mono">&lt;=</td><td>Less than or equal</td></tr>
                <tr className="border-t border-zinc-200 dark:border-zinc-600"><td className="px-2 py-1.5 font-mono">=</td><td>Equal to</td></tr>
                <tr className="border-t border-zinc-200 dark:border-zinc-600"><td className="px-2 py-1.5 font-mono">&lt;&gt;</td><td>Not equal to</td></tr>
              </tbody>
            </table>
          </section>

          <section>
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-2">Math Operators</h3>
            <p><code className="font-mono">+</code> <code className="font-mono">-</code> <code className="font-mono">*</code> <code className="font-mono">/</code> <code className="font-mono">^</code> (add, subtract, multiply, divide, exponent).</p>
          </section>

          <section>
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-2">Logical Operators</h3>
            <p><code className="font-mono">AND</code> <code className="font-mono">OR</code> <code className="font-mono">NOT</code> — Combine or negate conditions. Example: <code className="font-mono">P &gt; 10 AND V &gt; 500000</code>.</p>
          </section>

          <section>
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-2">Functions</h3>
            <p className="mb-2">All functions use the current bar as the rightmost bar; lookback is over the last <code className="font-mono">n</code> bars.</p>
            <table className="w-full border border-zinc-200 dark:border-zinc-600 rounded overflow-hidden text-left">
              <thead>
                <tr className="bg-zinc-100 dark:bg-zinc-700">
                  <th className="px-2 py-1.5 font-medium">Function</th>
                  <th className="px-2 py-1.5 font-medium">Definition / Calculation</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-zinc-200 dark:border-zinc-600">
                  <td className="px-2 py-1.5 font-mono">MA(series, n [, bar])</td>
                  <td>Simple moving average over n bars. Optional third argument <em>bar</em>: compute the MA at that bar index (e.g. MA(C, 200, 30) = 200‑day MA 30 bars ago).</td>
                </tr>
                <tr className="border-t border-zinc-200 dark:border-zinc-600">
                  <td className="px-2 py-1.5 font-mono">EMA(series, n)</td>
                  <td>Exponential moving average: first value is the average of the first n bars, then EMA = k × current + (1 − k) × previous EMA, where k = 2/(n+1).</td>
                </tr>
                <tr className="border-t border-zinc-200 dark:border-zinc-600">
                  <td className="px-2 py-1.5 font-mono">SUM(series, n)</td>
                  <td>Sum of the last n values of the series.</td>
                </tr>
                <tr className="border-t border-zinc-200 dark:border-zinc-600">
                  <td className="px-2 py-1.5 font-mono">MAX(series, n)</td>
                  <td>Highest value of the series over the last n bars.</td>
                </tr>
                <tr className="border-t border-zinc-200 dark:border-zinc-600">
                  <td className="px-2 py-1.5 font-mono">MIN(series, n)</td>
                  <td>Lowest value of the series over the last n bars.</td>
                </tr>
                <tr className="border-t border-zinc-200 dark:border-zinc-600">
                  <td className="px-2 py-1.5 font-mono">ATR(n)</td>
                  <td>Average True Range over n bars: True Range = max(H−L, |H−prev close|, |L−prev close|); ATR is the smoothed average of TR.</td>
                </tr>
                <tr className="border-t border-zinc-200 dark:border-zinc-600">
                  <td className="px-2 py-1.5 font-mono">ATRP(n)</td>
                  <td>ATR as percentage of close: ATR(n) / C. Use for volatility relative to price (e.g. ATRP(14) &gt; 0.02 for 2% ATR).</td>
                </tr>
                <tr className="border-t border-zinc-200 dark:border-zinc-600">
                  <td className="px-2 py-1.5 font-mono">ROC(series, n [, bar])</td>
                  <td>Rate of change (percent): (value at bar − value n bars earlier) / value n bars earlier × 100. Optional third argument: compute at that bar index (e.g. ROC(C, 1, 1) = yesterday’s 1‑day gain %).</td>
                </tr>
                <tr className="border-t border-zinc-200 dark:border-zinc-600">
                  <td className="px-2 py-1.5 font-mono">RVOL(n)</td>
                  <td>Relative volume: current volume / average volume over last n bars. RVOL(20) = V / average(V over 20 bars).</td>
                </tr>
                <tr className="border-t border-zinc-200 dark:border-zinc-600">
                  <td className="px-2 py-1.5 font-mono">ABS(x)</td>
                  <td>Absolute value of x (one numeric expression).</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section>
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-2">Variable assignment</h3>
            <p>You can name an expression and reuse it: <code className="font-mono">Name = expression;</code> Then use <code className="font-mono">Name</code> in the final condition. Example: <code className="font-mono">X = MA(C, 50); P &gt; X AND P &gt; 10</code>.</p>
          </section>

          <section>
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-2">Examples</h3>
            <ul className="list-disc pl-5 space-y-1">
              <li><code className="font-mono">P &gt; 10</code> — Close price greater than 10.</li>
              <li><code className="font-mono">MA(C, 50) &gt; 500000</code> — 50-day simple moving average of close greater than 500,000 (e.g. for volume you’d use V).</li>
              <li><code className="font-mono">P &gt; 10 AND V &gt; 1000000</code> — Price and volume conditions combined.</li>
              <li><code className="font-mono">C &gt; O AND V &gt; MA(V, 20)</code> — Up bar with volume above 20-day average (using P or C for close).</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
