"use client";

import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Cell,
  Line,
  LineChart,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  CartesianGrid,
  Legend,
} from "recharts";
import type { CotSeriesPoint } from "@/lib/cot/contracts";
import { formatAxisDate, formatReportDate, formatSignedCompact } from "./format";

export type CotView = "positioning" | "index";

// Chart colours mapped to the StockStalker workspace palette (hex mirrors the --ws-* tokens;
// SVG presentation attributes don't resolve CSS var(), so hex values are used directly).
export const COT_COLORS = {
  commercial: "#3DDC84", // --ws-green (hedger / neutral)
  largeSpec: "#f59e0b", // --ws-amber (accent / primary series)
  smallSpec: "#7B8794", // muted grey (tertiary)
  spread: "#a78bfa", // --ws-purple (highlight)
  index: "#00e5cc", // --ws-cyan (primary line)
  danger: "#EF4468", // --ws-red (80 reference)
  info: "#5C9EF5", // --ws-blue (20 reference)
  long: "#3DDC84", // net long position (green)
  short: "#EF4468", // net short position (red)
  axis: "#9aa7b8", // brighter axis labels for legibility
  grid: "rgba(255,255,255,0.06)",
};

// Net bars are coloured by direction: green when net long (≥0), red when net short (<0).
function netFill(v: number | null | undefined): string {
  return (v ?? 0) >= 0 ? COT_COLORS.long : COT_COLORS.short;
}

function LegendSwatch({ color, dashed }: { color: string; dashed?: boolean }) {
  if (dashed) {
    return <span style={{ width: 12, borderTop: `2px dashed ${color}`, display: "inline-block" }} />;
  }
  return <span style={{ width: 10, height: 10, background: color, borderRadius: 2, display: "inline-block" }} />;
}

// Custom legend: recharts auto-derives series labels, so a manual legend is used to convey
// the direction-based colouring (green = net long, red = net short) instead of per-camp names.
function PositioningLegend() {
  const items: { color: string; label: string; dashed?: boolean }[] = [
    { color: COT_COLORS.long, label: "Net long" },
    { color: COT_COLORS.short, label: "Net short" },
    { color: COT_COLORS.spread, label: "Spread", dashed: true },
  ];
  return (
    <div style={{ display: "flex", justifyContent: "center", gap: 14, fontSize: 10, color: "var(--ws-text)" }}>
      {items.map((it) => (
        <span key={it.label} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <LegendSwatch color={it.color} dashed={it.dashed} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

const axisTick = { fontSize: 10, fill: COT_COLORS.axis };

const tooltipStyle = {
  background: "var(--ws-bg3)",
  border: "1px solid var(--ws-border-hover)",
  borderRadius: 6,
  fontSize: 11,
};

const NET_LABELS: Record<string, string> = {
  comm_net: "Commercial",
  large_spec_net: "Large spec",
  small_spec_net: "Small spec",
  spread: "Spread",
  cot_index: "COT index",
};

function netTooltipFormatter(
  value: number | string | ReadonlyArray<number | string> | undefined,
  name: number | string | undefined
): [string, string] {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = typeof raw === "number" ? raw : Number(raw);
  return [formatSignedCompact(n), NET_LABELS[String(name)] ?? String(name)];
}

export default function CotChart({ view, data }: { view: CotView; data: CotSeriesPoint[] }) {
  if (!data.length) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="text-ws-caption" style={{ color: "var(--ws-text-dim)" }}>
          No data in range
        </span>
      </div>
    );
  }

  if (view === "index") {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
          <CartesianGrid stroke={COT_COLORS.grid} vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={formatAxisDate}
            axisLine={false}
            tickLine={false}
            tick={axisTick}
            minTickGap={28}
          />
          <YAxis
            orientation="right"
            domain={[0, 100]}
            ticks={[0, 20, 50, 80, 100]}
            axisLine={false}
            tickLine={false}
            tick={axisTick}
            width={32}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            cursor={{ stroke: "rgba(148,163,184,0.35)", strokeWidth: 1 }}
            formatter={(v) => [String(Math.round(Number(v))), "COT index"]}
            labelFormatter={(label) => formatReportDate(String(label))}
          />
          <ReferenceLine y={80} stroke={COT_COLORS.danger} strokeOpacity={0.7} strokeDasharray="4 4" />
          <ReferenceLine y={20} stroke={COT_COLORS.info} strokeOpacity={0.7} strokeDasharray="4 4" />
          <Line
            type="monotone"
            dataKey="cot_index"
            stroke={COT_COLORS.index}
            strokeWidth={1.8}
            dot={false}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }} barGap={1} barCategoryGap="8%">
        <CartesianGrid stroke={COT_COLORS.grid} vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={formatAxisDate}
          axisLine={false}
          tickLine={false}
          tick={axisTick}
          minTickGap={28}
        />
        <YAxis
          yAxisId="left"
          orientation="left"
          axisLine={false}
          tickLine={false}
          tick={axisTick}
          width={40}
          tickFormatter={(v) => formatSignedCompact(Number(v))}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          axisLine={false}
          tickLine={false}
          tick={axisTick}
          width={40}
          tickFormatter={(v) => formatSignedCompact(Number(v))}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          cursor={{ fill: "rgba(148,163,184,0.10)" }}
          formatter={netTooltipFormatter}
          labelFormatter={(label) => formatReportDate(String(label))}
        />
        <Legend verticalAlign="bottom" height={22} content={<PositioningLegend />} />
        <ReferenceLine yAxisId="left" y={0} stroke="rgba(255,255,255,0.18)" />
        <Bar yAxisId="left" name="Commercial" dataKey="comm_net" maxBarSize={30} radius={[2, 2, 0, 0]}>
          {data.map((d, i) => (
            <Cell key={`comm-${i}`} fill={netFill(d.comm_net)} />
          ))}
        </Bar>
        <Bar yAxisId="left" name="Large spec" dataKey="large_spec_net" maxBarSize={30} radius={[2, 2, 0, 0]}>
          {data.map((d, i) => (
            <Cell key={`lspec-${i}`} fill={netFill(d.large_spec_net)} />
          ))}
        </Bar>
        <Bar yAxisId="left" name="Small spec" dataKey="small_spec_net" maxBarSize={30} radius={[2, 2, 0, 0]}>
          {data.map((d, i) => (
            <Cell key={`sspec-${i}`} fill={netFill(d.small_spec_net)} />
          ))}
        </Bar>
        <Line
          yAxisId="right"
          name="Spread"
          type="monotone"
          dataKey="spread"
          stroke={COT_COLORS.spread}
          strokeWidth={1.6}
          strokeDasharray="5 3"
          dot={false}
          connectNulls
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
