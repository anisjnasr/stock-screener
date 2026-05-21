import type { ReactNode } from "react";
import {
  compsCategories,
  compsSegmentWidths,
  formatCompsExampleOutcome,
  formatMonoPrice,
  formatSignedPct,
  type CompsDisplay,
} from "@/lib/premarket/large-cap-verdict-display";

const LC_FIELD_LABEL_COLOR = "#c5cdd9";
const LC_FIELD_LABEL_MUTED_COLOR = "#a8b2c0";
const LC_VALUE_COLOR = "var(--text-primary)";

const COMPS_BAR_COLORS = {
  follow_through: "rgba(74,222,128,0.35)",
  reversal: "rgba(248,113,113,0.35)",
  flat: "rgba(255,255,255,0.08)",
} as const;

function CompsFieldLabel({
  children,
  muted = false,
}: {
  children: ReactNode;
  muted?: boolean;
}) {
  return (
    <span
      className="text-xs font-medium"
      style={{ color: muted ? LC_FIELD_LABEL_MUTED_COLOR : LC_FIELD_LABEL_COLOR }}
    >
      {children}
    </span>
  );
}

function CompsFieldValue({
  children,
  className = "text-xs shrink-0",
  muted = false,
}: {
  children: ReactNode;
  className?: string;
  muted?: boolean;
}) {
  return (
    <span
      className={`pm-mono font-medium ${className}`.trim()}
      style={{ color: muted ? LC_FIELD_LABEL_MUTED_COLOR : LC_VALUE_COLOR }}
    >
      {children}
    </span>
  );
}

export default function CompsSection({ comps }: { comps: CompsDisplay }) {
  const { followPct, reversalPct, flatPct } = compsSegmentWidths(comps);
  const categories = compsCategories(comps);

  const pctByKey = {
    follow_through: followPct,
    reversal: reversalPct,
    flat: flatPct,
  } as const;

  const barSegments = [
    { key: "follow_through" as const, pct: followPct, count: comps.follow_through },
    { key: "reversal" as const, pct: reversalPct, count: comps.reversal },
    { key: "flat" as const, pct: flatPct, count: comps.flat },
  ].filter((seg) => seg.count > 0);

  return (
    <div className="lc-comps space-y-2">
      <div className="lc-comps-legend flex w-full text-xs">
        {categories.map(({ key, label, count }) => {
          const isZero = count === 0;
          const pct = pctByKey[key];
          return (
            <div
              key={key}
              className={`flex items-baseline gap-1.5 min-w-0 ${
                isZero ? "ml-auto shrink-0 pl-2" : "justify-center"
              }`}
              style={isZero ? undefined : { width: `${pct}%` }}
            >
              <CompsFieldLabel muted={isZero}>{label}</CompsFieldLabel>
              <CompsFieldValue muted={isZero}>
                {count}/{comps.total}
              </CompsFieldValue>
            </div>
          );
        })}
      </div>

      {barSegments.length > 0 ? (
        <div className="lc-comps-bar flex h-2 w-full overflow-hidden rounded">
          {barSegments.map(({ key, pct }) => (
            <div
              key={key}
              className={`lc-comps-bar-segment lc-comps-bar-segment--${key.replace("_", "-")}`}
              style={{
                width: `${pct}%`,
                background: COMPS_BAR_COLORS[key],
              }}
              aria-hidden
            />
          ))}
        </div>
      ) : (
        <div className="lc-comps-bar lc-comps-bar--empty h-2 w-full rounded" aria-hidden />
      )}

      <div className="grid grid-cols-3 gap-2 text-xs">
        {(
          [
            ["Average Range", `${formatMonoPrice(comps.avg_next_day_range_pct)}%`],
            ["Average Follow Through", `${formatMonoPrice(comps.avg_follow_through_pct)}%`],
            ["Average Reversal", `${formatMonoPrice(comps.avg_reversal_pct)}%`],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="flex flex-col items-center gap-0.5 text-center">
            <CompsFieldLabel>{label}</CompsFieldLabel>
            <CompsFieldValue>{value}</CompsFieldValue>
          </div>
        ))}
      </div>

      {comps.recent_examples.length > 0 ? (
        <div className="lc-comps-examples">
          <div
            className="lc-comps-examples-grid text-xs font-medium mb-1"
            style={{ color: LC_FIELD_LABEL_MUTED_COLOR }}
          >
            <span>Date</span>
            <span>Gap</span>
            <span>Outcome</span>
          </div>
          {comps.recent_examples.map((ex) => (
            <div key={ex.date} className="lc-comps-examples-grid text-xs">
              <CompsFieldValue className="text-xs">{ex.date}</CompsFieldValue>
              <CompsFieldValue className="text-xs">{formatSignedPct(ex.comp_gap_pct)}</CompsFieldValue>
              <span className="text-xs" style={{ color: LC_VALUE_COLOR }}>
                {formatCompsExampleOutcome(ex.outcome, ex.outcome_pct)}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
