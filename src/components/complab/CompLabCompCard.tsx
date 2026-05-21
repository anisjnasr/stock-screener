"use client";

import dynamic from "next/dynamic";
import type { CompLabCandle } from "@/lib/complab/chart-series";
import type { CompLabComp } from "@/lib/complab/comp-lab-comps";

const CompLabMiniChart = dynamic(() => import("@/components/complab/CompLabMiniChart"), {
  ssr: false,
  loading: () => (
    <div
      className="h-[180px] w-full rounded border"
      style={{ borderColor: "var(--ws-border)", background: "#292b31" }}
    />
  ),
});

type Props = {
  comp: CompLabComp;
  candles: CompLabCandle[];
};

export default function CompLabCompCard({ comp, candles }: Props) {
  return (
    <article
      className="flex min-h-[360px] flex-col overflow-hidden rounded border"
      style={{ borderColor: "var(--ws-border)", background: "var(--ws-bg3)" }}
    >
      <CompLabMiniChart candles={candles} compDate={comp.comp_date} />

      <div className="flex flex-1 flex-col gap-2 px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <p className="font-mono text-sm font-semibold" style={{ color: "var(--ws-text)" }}>
            {comp.comp_date}
          </p>
          <p className="shrink-0 text-sm font-semibold tabular-nums" style={{ color: "var(--ws-cyan)" }}>
            {comp.similarity_score}
            <span className="text-xs font-normal" style={{ color: "var(--ws-text-dim)" }}>
              /100
            </span>
          </p>
        </div>

        <p className="text-xs leading-snug" style={{ color: "var(--ws-text-dim)" }}>
          {comp.setup_signature}
        </p>

        <p className="text-xs font-medium" style={{ color: "var(--ws-text)" }}>
          {comp.outcome_label}
        </p>
      </div>
    </article>
  );
}
