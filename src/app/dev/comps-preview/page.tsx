import CompsSection from "@/components/premarket/CompsSection";
import { formatCompsSectionTitle, type CompsDisplay } from "@/lib/premarket/large-cap-verdict-display";
import "@/components/premarket/premarket-terminal.css";

const lowSampleComps: CompsDisplay = {
  total: 16,
  follow_through: 8,
  reversal: 8,
  flat: 0,
  avg_next_day_range_pct: 2.4,
  avg_follow_through_pct: 1.8,
  avg_reversal_pct: 2.1,
  low_sample: true,
  recent_examples: [
    {
      date: "2026-01-16",
      comp_gap_pct: -2.48,
      outcome: "reversal",
      outcome_pct: 2.58,
    },
  ],
};

const fullSampleComps: CompsDisplay = {
  total: 24,
  follow_through: 10,
  reversal: 12,
  flat: 2,
  avg_next_day_range_pct: 2.6,
  avg_follow_through_pct: 1.9,
  avg_reversal_pct: 2.3,
  low_sample: false,
  recent_examples: [
    {
      date: "2026-01-16",
      comp_gap_pct: -2.48,
      outcome: "reversal",
      outcome_pct: 2.58,
    },
    {
      date: "2025-11-03",
      comp_gap_pct: 1.12,
      outcome: "follow_through",
      outcome_pct: 3.04,
    },
  ],
};

export default function CompsPreviewPage() {
  return (
    <div className="premarket-terminal min-h-screen p-6 space-y-8" style={{ background: "var(--bg-base, #0a0a0a)" }}>
      <section className="max-w-md space-y-2">
        <h2 className="text-sm font-medium" style={{ color: "var(--ws-cyan)" }}>
          {formatCompsSectionTitle(lowSampleComps.total)}
        </h2>
        <CompsSection comps={lowSampleComps} />
      </section>
      <section className="max-w-md space-y-2">
        <h2 className="text-sm font-medium" style={{ color: "var(--ws-cyan)" }}>
          {formatCompsSectionTitle(fullSampleComps.total)}
        </h2>
        <CompsSection comps={fullSampleComps} />
      </section>
    </div>
  );
}
