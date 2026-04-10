"use client";

import type { ReactNode } from "react";

type SSLHelpProps = {
  onClose: () => void;
};

function Code({ children }: { children: ReactNode }) {
  return <code className="font-mono text-[11px] sm:text-xs bg-zinc-100 dark:bg-zinc-900/80 px-1 py-0.5 rounded">{children}</code>;
}

function H3({ children }: { children: ReactNode }) {
  return <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-2 mt-6 first:mt-0">{children}</h3>;
}

function H4({ children }: { children: ReactNode }) {
  return <h4 className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 mb-1.5 mt-4">{children}</h4>;
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p className="text-xs text-amber-900 dark:text-amber-200/90 bg-amber-50 dark:bg-amber-900/25 border border-amber-200 dark:border-amber-800/60 rounded px-2 py-1.5">
      {children}
    </p>
  );
}

/** Spec-aligned reference; “Engine” = StockStalker scan evaluator in this app. */
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
        className="bg-white dark:bg-zinc-800 rounded-lg shadow-xl border border-zinc-200 dark:border-zinc-700 w-full max-w-4xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-3 border-b border-zinc-200 dark:border-zinc-700 shrink-0">
          <h2 id="ssl-help-title" className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 tracking-wide">
            StockStalker Scan Language (SSL) — reference
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
        <div className="flex-1 overflow-auto p-4 text-sm text-zinc-700 dark:text-zinc-300 space-y-1">
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-3">
            Structure follows the SSL specification. Identifiers and function names are <strong>case-insensitive</strong>. The scan uses stored daily
            bars, the screener snapshot, and rows from the <Code>financials</Code> table for fundamentals (not live intraday). <Code>C</Code> is the
            latest stored close for the scan date.
          </p>

          <Note>
            <strong>Engine coverage:</strong> Functions marked “Yes” are evaluated in scans. “No” = parsed/reserved but not evaluated here (conditions
            using them will not pass). <Code>RS</Code> uses periods <Code>0</Code> (1-week), <Code>1</Code>, <Code>3</Code>, <Code>6</Code>,{" "}
            <Code>12</Code> (months). <Code>IndRank</Code> / <Code>IndustryRank</Code>: <Code>1</Code>, <Code>3</Code>, <Code>6</Code>, <Code>12</Code>{" "}
            only. Quarterly/annual fundamentals <Code>Q</Code>, <Code>A</Code>, <Code>AVG_Q</Code>/<Code>AVG_A</Code>, <Code>MIN_*</Code>,{" "}
            <Code>MAX_*</Code>, <Code>SUM_*</Code> are evaluated when data exists; <Code>STREAK_Q</Code>/<Code>STREAK_A</Code> are not. Reserved
            identifiers such as <Code>EPS_GROWTH_QOQ</Code> or <Code>EPS_SURPRISE</Code> have no stored column yet and always evaluate empty.
          </Note>

          {/* --- 2. Language structure --- */}
          <H3>2. Language structure</H3>
          <H4>2.1 Statements</H4>
          <p className="text-xs mb-2">
            Each statement ends with <Code>;</Code>. The filter is a boolean expression (combined with <Code>AND</Code> / <Code>OR</Code> /{" "}
            <Code>NOT</Code>). Use <Code>==</Code> or <Code>!=</Code> for equality; <Code>=</Code> is only for assignment.
          </p>
          <H4>2.2 Comments</H4>
          <p className="text-xs mb-2">
            <Code>// line comment</Code> and <Code>/* block */</Code>.
          </p>
          <H4>2.3 Identifiers</H4>
          <p className="text-xs mb-2">Letters, digits, underscore; must start with a letter. Cannot reuse reserved names (price arrays, builtins).</p>
          <H4>2.4 Constants</H4>
          <p className="text-xs mb-2">Numbers; strings in double quotes; comparisons yield <Code>1</Code> / <Code>0</Code>.</p>

          {/* --- 3. Data --- */}
          <H3>3. Price arrays and reference data</H3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse border border-zinc-200 dark:border-zinc-600">
              <thead>
                <tr className="bg-zinc-100 dark:bg-zinc-900/50">
                  <th className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 text-left">Identifier</th>
                  <th className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 text-left">Alias</th>
                  <th className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 text-left">Meaning</th>
                  <th className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 text-left">Engine</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["Open", "O", "Daily open", "Yes"],
                  ["High", "H", "Daily high", "Yes"],
                  ["Low", "L", "Daily low", "Yes"],
                  ["Close", "C, P", "Daily close (P same as C)", "Yes"],
                  ["Volume", "V", "Daily volume", "Yes"],
                ].map(([a, b, c, d]) => (
                  <tr key={String(a)}>
                    <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 font-mono">{a}</td>
                    <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 font-mono">{b}</td>
                    <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1">{c}</td>
                    <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1">{d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs mt-2">
            <strong>Lookback:</strong> <Code>C[1]</Code> shifts <strong>trading days</strong>; <Code>MA(C,20)[5]</Code> evaluates the MA on earlier bars; or{" "}
            <Code>Ref(C, -1)</Code> (negative = past only). On <Code>Q</Code>, <Code>A</Code>, <Code>AVG_Q</Code>, <Code>AVG_A</Code>, and the other
            quarterly/annual aggregates in §6.9, postfix <Code>[n]</Code> shifts <strong>fiscal quarters or years</strong> (not bars). Example:{" "}
            <Code>Q(EPS_GROWTH_YOY, 0)[1]</Code> is the same quarter offset as <Code>Q(EPS_GROWTH_YOY, 1)</Code>.
          </p>
          <H4>3.2 Reference scalars (per stock)</H4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse border border-zinc-200 dark:border-zinc-600">
              <thead>
                <tr className="bg-zinc-100 dark:bg-zinc-900/50">
                  <th className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 text-left">Identifier</th>
                  <th className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 text-left">Application</th>
                  <th className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 text-left">Engine</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["MARKET_CAP, MC", "Market cap (USD)", "Yes — snapshot"],
                  ["IPO_DATE, IPODATE", "IPO date string; compare with &gt;, ==, etc.", "Yes — snapshot"],
                  ["SECTOR, INDUSTRY", "GICS strings; use == with quoted sector/industry", "Yes — snapshot"],
                  ["NAME", "Ticker symbol for current row", "Yes — context"],
                  ["ADV", "Average daily volume (~50 trading days from bars)", "Yes — from bars"],
                  ["DAYS_SINCE_IPO", "Trading-style count from snapshot", "Yes — snapshot"],
                  ["SHARES_OUT", "Shares outstanding", "Yes — snapshot"],
                  ["FLOAT, SHORT_INT", "Reserved in language; not mapped to snapshot here", "No"],
                ].map(([a, b, c]) => (
                  <tr key={String(a)}>
                    <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 font-mono">{a}</td>
                    <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1">{b}</td>
                    <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1">{c}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <H4>3.3 RS and industry rank</H4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse border border-zinc-200 dark:border-zinc-600">
              <thead>
                <tr className="bg-zinc-100 dark:bg-zinc-900/50">
                  <th className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 text-left">Function</th>
                  <th className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 text-left">Arguments</th>
                  <th className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 text-left">Returns / use</th>
                  <th className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 text-left">Engine</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 font-mono">RS(months)</td>
                  <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1">
                    One integer: <Code>0</Code> = 1w percentile, <Code>1|3|6|12</Code> = months
                  </td>
                  <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1">RS percentile 0–100 vs universe</td>
                  <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1">Yes</td>
                </tr>
                <tr>
                  <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 font-mono">IndRank(n)</td>
                  <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1">
                    <Code>1|3|6|12</Code> — aliases <Code>INDRS</Code>, <Code>IndustryRank</Code>
                  </td>
                  <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1">Industry rank (1 = strongest)</td>
                  <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1">Yes</td>
                </tr>
              </tbody>
            </table>
          </div>
          <H4>3.4 Fundamental time-series fields</H4>
          <p className="text-xs mb-2">
            Use quarterly fields only inside <Code>Q</Code> / <Code>AVG_Q</Code> / <Code>MIN_Q</Code> / <Code>MAX_Q</Code> / <Code>SUM_Q</Code>, and
            annual field names only inside <Code>A</Code> / <Code>AVG_A</Code> / <Code>MIN_A</Code> / <Code>MAX_A</Code> / <Code>SUM_A</Code> (§6.9). Data
            comes from the <Code>financials</Code> table: periods with{" "}
            <Code>period_end ≤ scan date</Code>, ordered newest first (index <Code>0</Code> = latest filed period). <Code>REVENUE</Code> is stored sales.{" "}
            <Code>MA(EPS, …)</Code> and other <strong>daily</strong> rolling functions on a bare fundamental identifier are invalid and yield no match.
            In filters, read a field with <Code>Q(…)</Code> or <Code>A(…)</Code> (e.g. latest-quarter EPS growth is <Code>Q(EPS_GROWTH_YOY, 0)</Code>, not a
            bare <Code>EPS_GROWTH_YOY</Code> identifier).
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse border border-zinc-200 dark:border-zinc-600">
              <thead>
                <tr className="bg-zinc-100 dark:bg-zinc-900/50">
                  <th className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 text-left">SSL field (Q / aggregates)</th>
                  <th className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 text-left">SSL field (A / aggregates)</th>
                  <th className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 text-left">DB column</th>
                  <th className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 text-left">Scale in engine</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["EPS", "EPS_ANNUAL", "eps", "Level — USD per share"],
                  ["REVENUE", "REV_ANNUAL", "sales", "Level — same units as stored revenue"],
                  ["EPS_GROWTH_YOY", "EPS_GROWTH_ANNUAL", "eps_growth_yoy", "YoY % as percentage points (20 = 20%, not 0.20)"],
                  ["REV_GROWTH_YOY", "REV_GROWTH_ANNUAL", "sales_growth_yoy", "YoY % as percentage points (20 = 20%, not 0.20)"],
                ].map(([q, a, db, scale]) => (
                  <tr key={String(q)}>
                    <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 font-mono">{q}</td>
                    <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 font-mono">{a}</td>
                    <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 font-mono">{db}</td>
                    <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1">{scale}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs mt-2">
            <strong>Growth thresholds:</strong> YoY growth values are year-over-year percent change on a 0–100 style scale. Use integer or fractional
            thresholds the same way (e.g. <Code>Q(EPS_GROWTH_YOY, 0) &gt;= 20</Code> means EPS up at least 20% YoY; <Code>Q(REV_GROWTH_YOY, 0) &gt;= 10</Code>{" "}
            for revenue).
          </p>
          <p className="text-xs mt-2">
            <strong>Not in DB (reserved / no value):</strong> QoQ growth, EPS surprise, and similar — expressions using only those stay empty / non-passing.
          </p>

          {/* --- 4. Operators --- */}
          <H3>4. Operators</H3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse border border-zinc-200 dark:border-zinc-600">
              <thead>
                <tr className="bg-zinc-100 dark:bg-zinc-900/50">
                  <th className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 text-left">Operators</th>
                  <th className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 text-left">Meaning</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["+, -, *, /, %, ^", "Arithmetic (element-wise on last bar)"],
                  [">, <, >=, <=, ==, !=, <>", "Comparison → 1 or 0"],
                  ["AND, OR, NOT", "Logic"],
                  ["=", "Assignment only (not equality)"],
                ].map(([a, b]) => (
                  <tr key={String(a)}>
                    <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 font-mono">{a}</td>
                    <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1">{b}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs mt-2">
            Precedence (high → low): <Code>^</Code>, unary <Code>-</Code> / <Code>NOT</Code>, <Code>* / %</Code>, <Code>+ -</Code>, comparisons,{" "}
            <Code>AND</Code>, <Code>OR</Code>, <Code>=</Code>. Parentheses override.
          </p>

          {/* --- 6. Functions --- */}
          <H3>6. Built-in functions</H3>
          <p className="text-xs mb-2">
            Rolling functions (<Code>MA</Code>, <Code>EMA</Code>, <Code>WMA</Code>, <Code>SUM</Code>, <Code>HHV</Code>, <Code>LLV</Code>,{" "}
            <Code>STDEV</Code>/<Code>STDDEV</Code>, <Code>ROC</Code>) evaluate the <strong>first argument</strong> as an expression over{" "}
            <strong>daily bars</strong>; <strong>period</strong> is a positive integer (bars). The scan uses the <strong>most recent bar</strong> (index 0).
            Do not pass a bare fundamental field (e.g. <Code>EPS</Code>) as that first argument; use <Code>Q(EPS, 0)</Code> or another numeric series
            (see §3.4).
          </p>

          <H4>6.1 Moving averages</H4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse border border-zinc-200 dark:border-zinc-600">
              <thead>
                <tr className="bg-zinc-100 dark:bg-zinc-900/50">
                  <th className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 text-left">Function</th>
                  <th className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 text-left">Arguments</th>
                  <th className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 text-left">Application</th>
                  <th className="border border-zinc-200 dark:border-zinc-600 px-2 py-1">Eng</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["MA(array, period)", "Any numeric series, period ≥ 1", "Simple moving average", "Yes"],
                  ["EMA(array, period)", "Any numeric series, period ≥ 1", "Exponential MA", "Yes"],
                  ["WMA(array, period)", "Any numeric series, period ≥ 1", "Weighted MA (linear weights)", "Yes"],
                ].map(([fn, args, app, eng]) => (
                  <tr key={String(fn)}>
                    <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 font-mono whitespace-nowrap">{fn}</td>
                    <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1">{args}</td>
                    <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1">{app}</td>
                    <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 text-center">{eng}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <H4>6.2 Aggregation / window</H4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse border border-zinc-200 dark:border-zinc-600">
              <thead>
                <tr className="bg-zinc-100 dark:bg-zinc-900/50">
                  <th className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 text-left">Function</th>
                  <th className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 text-left">Arguments</th>
                  <th className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 text-left">Application</th>
                  <th className="border border-zinc-200 dark:border-zinc-600 px-2 py-1">Eng</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["HHV(array, period)", "High (or any series), n bars", "Highest in window", "Yes"],
                  ["LLV(array, period)", "Low (or any series), n bars", "Lowest in window", "Yes"],
                  ["Sum(array, period)", "Series, n", "Sum over window (spec: Sum)", "Yes — SUM"],
                  ["StDev(array, period)", "Series, n", "Population stdev over window", "Yes — STDEV / STDDEV"],
                ].map(([fn, args, app, eng]) => (
                  <tr key={String(fn)}>
                    <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 font-mono whitespace-nowrap">{fn}</td>
                    <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1">{args}</td>
                    <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1">{app}</td>
                    <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 text-center">{eng}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <H4>6.3 Technical indicators</H4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse border border-zinc-200 dark:border-zinc-600">
              <thead>
                <tr className="bg-zinc-100 dark:bg-zinc-900/50">
                  <th className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 text-left">Function</th>
                  <th className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 text-left">Arguments</th>
                  <th className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 text-left">Application</th>
                  <th className="border border-zinc-200 dark:border-zinc-600 px-2 py-1">Eng</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["ATR(period)", "period ≥ 1", "Average True Range ($), Wilder", "Yes"],
                  ["ATRP(period)", "period ≥ 1", "ATR as % of close ×100", "Yes"],
                  ["VWAP()", "None", "Session-style VWAP from current bar through history in loaded slice", "Yes"],
                  ["BBTop(period, width)", "period, std widths (e.g. 20, 2)", "Upper Bollinger band on close", "Yes — BBTOP"],
                  ["BBBot(period, width)", "period, width", "Lower Bollinger band", "Yes — BBBOT"],
                  ["ROC(array, period)", "Series, lookback bars", "% change vs period bars ago × 100", "Yes"],
                  ["RSI(period)", "period ≥ 1", "Relative Strength Index on close", "Yes"],
                ].map(([fn, args, app, eng]) => (
                  <tr key={String(fn)}>
                    <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 font-mono whitespace-nowrap">{fn}</td>
                    <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1">{args}</td>
                    <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1">{app}</td>
                    <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 text-center">{eng}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <H4>6.4 Crossover</H4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse border border-zinc-200 dark:border-zinc-600">
              <thead>
                <tr className="bg-zinc-100 dark:bg-zinc-900/50">
                  <th className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 text-left">Function</th>
                  <th className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 text-left">Arguments</th>
                  <th className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 text-left">Application</th>
                  <th className="border border-zinc-200 dark:border-zinc-600 px-2 py-1">Eng</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["Cross(A, B)", "Two numeric series", "1 when A crosses above B on this bar", "Yes"],
                  ["CrossBelow(A, B)", "Two numeric series", "1 when A crosses below B", "Yes"],
                ].map(([fn, args, app, eng]) => (
                  <tr key={String(fn)}>
                    <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 font-mono whitespace-nowrap">{fn}</td>
                    <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1">{args}</td>
                    <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1">{app}</td>
                    <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 text-center">{eng}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <H4>6.5 Counting / bar functions</H4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse border border-zinc-200 dark:border-zinc-600">
              <thead>
                <tr className="bg-zinc-100 dark:bg-zinc-900/50">
                  <th className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 text-left">Function</th>
                  <th className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 text-left">Arguments</th>
                  <th className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 text-left">Application</th>
                  <th className="border border-zinc-200 dark:border-zinc-600 px-2 py-1">Eng</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 font-mono">BarsSince(cond)</td>
                  <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1">Boolean expression</td>
                  <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1">
                    Bars since condition was true (searches forward in history). Spelled <Code>BARSSINCE</Code> in scripts.
                  </td>
                  <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 text-center">Yes</td>
                </tr>
                {[
                  ["CountSince(cond, array)", "Condition, array", "Spec §6.5 — count true bars since event", "No"],
                  ["SumSince(cond, array)", "Condition, array", "Spec §6.5 — sum since event", "No"],
                ].map(([fn, args, app, eng]) => (
                  <tr key={String(fn)}>
                    <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 font-mono whitespace-nowrap">{fn}</td>
                    <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1">{args}</td>
                    <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1">{app}</td>
                    <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 text-center">{eng}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <H4>6.6 Math</H4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse border border-zinc-200 dark:border-zinc-600">
              <thead>
                <tr className="bg-zinc-100 dark:bg-zinc-900/50">
                  <th className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 text-left">Function</th>
                  <th className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 text-left">Arguments</th>
                  <th className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 text-left">Application</th>
                  <th className="border border-zinc-200 dark:border-zinc-600 px-2 py-1">Eng</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["Abs(x)", "numeric", "Absolute value", "Yes — ABS"],
                  ["Max(a, b)", "two numerics", "Element-wise max at bar", "Yes"],
                  ["Min(a, b)", "two numerics", "Element-wise min", "Yes"],
                  ["Sqrt(x)", "numeric ≥ 0", "Square root", "Yes — SQRT"],
                  ["Log(x)", "numeric &gt; 0", "Natural log", "Yes — LOG"],
                  ["Round(x, decimals)", "value, non‑negative integer d", "Round to d decimal places", "Yes"],
                ].map(([fn, args, app, eng]) => (
                  <tr key={String(fn)}>
                    <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 font-mono whitespace-nowrap">{fn}</td>
                    <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1">{args}</td>
                    <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1">{app}</td>
                    <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 text-center">{eng}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <H4>6.7 Conditional and reference</H4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse border border-zinc-200 dark:border-zinc-600">
              <thead>
                <tr className="bg-zinc-100 dark:bg-zinc-900/50">
                  <th className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 text-left">Function</th>
                  <th className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 text-left">Arguments</th>
                  <th className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 text-left">Application</th>
                  <th className="border border-zinc-200 dark:border-zinc-600 px-2 py-1">Eng</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["IIf(cond, trueVal, falseVal)", "boolean, any, any", "Chooses branch (both evaluated)", "Yes — IIF"],
                  ["Ref(array, periods)", "series, negative int", "Same as bracket lookback; positive periods disallowed", "Yes"],
                ].map(([fn, args, app, eng]) => (
                  <tr key={String(fn)}>
                    <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 font-mono whitespace-nowrap">{fn}</td>
                    <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1">{args}</td>
                    <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1">{app}</td>
                    <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 text-center">{eng}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <H4>6.8 Date / time (spec §6.8)</H4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse border border-zinc-200 dark:border-zinc-600">
              <thead>
                <tr className="bg-zinc-100 dark:bg-zinc-900/50">
                  <th className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 text-left">Function</th>
                  <th className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 text-left">Arguments</th>
                  <th className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 text-left">Application</th>
                  <th className="border border-zinc-200 dark:border-zinc-600 px-2 py-1">Eng</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["Today()", "—", "Calendar today as value in spec", "No"],
                  ["DateDiff(date1, date2)", "two dates", "Calendar days between", "No"],
                  ["TradingDaysSince(date)", "date", "Trading days since date", "No — TRADINGDAYSSINCE"],
                  ["DayOfWeek()", "—", "1=Mon … 5=Fri per bar", "No — DAYOFWEEK"],
                ].map(([fn, args, app, eng]) => (
                  <tr key={String(fn)}>
                    <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 font-mono whitespace-nowrap">{fn}</td>
                    <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1">{args}</td>
                    <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1">{app}</td>
                    <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 text-center">{eng}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <H4>6.9 Fundamental functions (quarterly / annual)</H4>
          <p className="text-xs mb-2">
            These read fiscal periods from <Code>financials</Code>, not daily bars. Only rows with <Code>period_end</Code> on or before the scan date are
            included; the series is newest-first, so <Code>n = 0</Code> or <Code>count</Code> starting at 0 refer to the latest available quarter or year.
          </p>
          <p className="text-xs mb-2">
            <strong>Postfix <Code>[n]</Code> on fundamental calls:</strong> shifts by <Code>n</Code> fiscal periods (quarters for <Code>Q*</Code>,
            years for <Code>A*</Code>). Multiple brackets add up (e.g. <Code>Q(EPS, 0)[1][1]</Code> uses the same row as <Code>Q(EPS, 2)</Code>). For{" "}
            <Code>Q(field, n)</Code> / <Code>A(field, n)</Code>, the row index is <Code>n +</Code> (sum of bracket offsets). For window functions{" "}
            <Code>AVG_Q(field, count)[s]</Code> (and <Code>MIN</Code>/<Code>MAX</Code>/<Code>SUM</Code> variants), the window covers <Code>count</Code>{" "}
            consecutive periods starting at index <Code>s</Code> (with <Code>s = 0</Code> when omitted). Every value in that window must be numeric; if any
            is missing or the range extends past stored history, the expression is empty (the filter will not pass on that symbol).
          </p>
          <p className="text-xs mb-2 text-zinc-600 dark:text-zinc-400">
            Examples: <Code>Q(REVENUE, 0) &gt; 1000;</Code> · <Code>Q(EPS_GROWTH_YOY, 0) &gt;= 20;</Code> (20% YoY EPS growth) ·{" "}
            <Code>Q(EPS_GROWTH_YOY, 0)[1] &gt; 10;</Code> · <Code>AVG_Q(EPS, 4) &gt; 1.5;</Code> · <Code>A(EPS_ANNUAL, 0) &gt; 3;</Code>
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse border border-zinc-200 dark:border-zinc-600">
              <thead>
                <tr className="bg-zinc-100 dark:bg-zinc-900/50">
                  <th className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 text-left">Function</th>
                  <th className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 text-left">Arguments</th>
                  <th className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 text-left">Application</th>
                  <th className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 text-left">Engine</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["Q(field, n)", "quarterly field, quarters ago (0 = latest)", "Point-in-quarter value", "Yes"],
                  ["AVG_Q(field, count)", "field, count", "Mean of count consecutive quarters from optional [s]", "Yes"],
                  ["MIN_Q(field, count)", "field, count", "Min over count consecutive quarters from [s]", "Yes"],
                  ["MAX_Q(field, count)", "field, count", "Max over count consecutive quarters from [s]", "Yes"],
                  ["SUM_Q(field, count)", "field, count", "Sum over count consecutive quarters from [s]", "Yes"],
                  ["STREAK_Q(condition)", "boolean on quarterly series", "Consecutive quarters condition held", "No"],
                  ["A(field, n)", "annual field, years ago (0 = latest)", "Point-in-year value", "Yes"],
                  ["AVG_A(field, count)", "field, count", "Mean of count fiscal years from [s]", "Yes"],
                  ["MIN_A(field, count)", "field, count", "Min over count years from [s]", "Yes"],
                  ["MAX_A(field, count)", "field, count", "Max over count years from [s]", "Yes"],
                  ["SUM_A(field, count)", "field, count", "Sum over count years from [s]", "Yes"],
                  ["STREAK_A(condition)", "boolean on annual series", "Consecutive years", "No"],
                ].map(([fn, args, app, eng]) => (
                  <tr key={String(fn)}>
                    <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1 font-mono whitespace-nowrap">{fn}</td>
                    <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1">{args}</td>
                    <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1">{app}</td>
                    <td className="border border-zinc-200 dark:border-zinc-600 px-2 py-1">{eng}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* --- 7. Scan structure --- */}
          <H3>7. Scan structure</H3>
          <ol className="list-decimal pl-5 text-xs space-y-1">
            <li>
              <strong>Assignments</strong> (optional): <Code>RVOL = V / MA(V, 20);</Code>
            </li>
            <li>
              <strong>Filter</strong> (required): boolean expression ending with <Code>;</Code>
            </li>
            <li>
              <strong>Result shaping</strong> (optional, must be last): one of
              <ul className="list-disc pl-5 mt-1">
                <li>
                  <Code>TopN(expr, n);</Code> — highest <Code>n</Code> by <Code>expr</Code>
                </li>
                <li>
                  <Code>BottomN(expr, n);</Code> — lowest <Code>n</Code>
                </li>
                <li>
                  <Code>SORT_BY = expr;</Code> optional <Code>ASC</Code>, with <Code>LIMIT = n;</Code>
                </li>
              </ul>
            </li>
          </ol>
          <p className="text-xs">Do not mix TopN/BottomN with SORT_BY/LIMIT in the same script (parser error).</p>

          {/* --- 9. Reserved --- */}
          <H3>9. Reserved words (summary)</H3>
          <p className="text-xs">
            Price: <Code>O H L C V P</Code> and long forms; reference: <Code>IPO_DATE MARKET_CAP SECTOR INDUSTRY NAME ADV …</Code>; ranking:{" "}
            <Code>RS IndRank</Code>; fundamentals field names; operators <Code>AND OR NOT</Code>; shaping <Code>TopN BottomN SORT_BY LIMIT ASC</Code>;
            and all builtin function names listed above. Using a reserved name as a user variable is rejected.
          </p>

          {/* --- 12.2 Results UI --- */}
          <H3>12.2 Results table (auto-columns)</H3>
          <p className="text-xs">
            Default columns: <strong>Flag</strong>, <strong>Ticker</strong>, <strong>Name</strong>, <strong>Price</strong>. Additional columns come
            from the script: named variables, non-trivial filter expressions (not bare <Code>C</Code> / constants), and the TopN/SORT expression when
            needed. Headers are abbreviated (e.g. <Code>MA V(21)</Code>, <Code>ROC(21)</Code>).
          </p>
        </div>
      </div>
    </div>
  );
}
