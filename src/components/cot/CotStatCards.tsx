"use client";

import type { CotSeriesPoint } from "@/lib/cot/contracts";
import { COT_COLORS } from "./CotChart";
import { formatSignedCompact } from "./format";

function indexSublabel(idx: number | null): { text: string; color: string } {
  if (idx === null) return { text: "no data", color: "var(--ws-text-vdim)" };
  if (idx >= 80) return { text: "bullish extreme", color: COT_COLORS.danger };
  if (idx <= 20) return { text: "bearish extreme", color: COT_COLORS.info };
  return { text: "mid-range", color: "var(--ws-text-dim)" };
}

function spreadSublabel(
  latest: CotSeriesPoint | null,
  prior: CotSeriesPoint | null
): { text: string; color: string } {
  if (!latest || latest.spread === null || !prior || prior.spread === null) {
    return { text: "vs prior wk", color: "var(--ws-text-vdim)" };
  }
  const wider = Math.abs(latest.spread) - Math.abs(prior.spread);
  if (Math.abs(wider) < 1) return { text: "flat vs prior wk", color: "var(--ws-text-dim)" };
  return wider > 0
    ? { text: "widening \u2191 vs prior wk", color: COT_COLORS.spread }
    : { text: "narrowing \u2193 vs prior wk", color: "var(--ws-text-dim)" };
}

function Card({
  label,
  value,
  accent,
  sublabel,
  sublabelColor,
}: {
  label: string;
  value: string;
  accent: string;
  sublabel: string;
  sublabelColor: string;
}) {
  return (
    <div
      className="flex min-w-[7.5rem] flex-1 flex-col gap-1 rounded-lg p-2.5"
      style={{ background: "var(--ws-bg)", border: "1px solid var(--ws-border)" }}
    >
      <div className="flex items-center gap-1.5">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: accent }} />
        <span
          className="text-ws-caption font-medium tracking-wide"
          style={{ color: "var(--ws-text-vdim)" }}
        >
          {label}
        </span>
      </div>
      <span className="text-ws-lead font-semibold tabular-nums" style={{ color: "var(--ws-text)" }}>
        {value}
      </span>
      <span className="text-ws-caption" style={{ color: sublabelColor }}>
        {sublabel}
      </span>
    </div>
  );
}

export default function CotStatCards({
  latest,
  prior,
}: {
  latest: CotSeriesPoint | null;
  prior: CotSeriesPoint | null;
}) {
  const idx = latest?.cot_index ?? null;
  const idxSub = indexSublabel(idx);
  const spreadSub = spreadSublabel(latest, prior);

  return (
    <div className="flex flex-wrap gap-2">
      <Card
        label="COT index"
        value={idx === null ? "—" : String(idx)}
        accent={COT_COLORS.index}
        sublabel={idxSub.text}
        sublabelColor={idxSub.color}
      />
      <Card
        label="Commercial net"
        value={formatSignedCompact(latest?.comm_net)}
        accent={COT_COLORS.commercial}
        sublabel="hedgers"
        sublabelColor="var(--ws-text-dim)"
      />
      <Card
        label="Large spec net"
        value={formatSignedCompact(latest?.large_spec_net)}
        accent={COT_COLORS.largeSpec}
        sublabel="funds"
        sublabelColor="var(--ws-text-dim)"
      />
      <Card
        label="Small spec net"
        value={formatSignedCompact(latest?.small_spec_net)}
        accent={COT_COLORS.smallSpec}
        sublabel="non-reportable"
        sublabelColor="var(--ws-text-dim)"
      />
      <Card
        label="Spread"
        value={formatSignedCompact(latest?.spread)}
        accent={COT_COLORS.spread}
        sublabel={spreadSub.text}
        sublabelColor={spreadSub.color}
      />
    </div>
  );
}
