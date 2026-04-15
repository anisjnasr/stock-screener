import type { IChartApiBase, IPanePrimitive, IPanePrimitivePaneView, IPrimitivePaneRenderer, Time, UTCTimestamp } from "lightweight-charts";

/** US equity regular session in America/New_York (Mon–Fri, 09:30–16:00 ET). */
export function isRegularUsEquityRthEt(utcMs: number): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(utcMs));
  const wk = parts.find((p) => p.type === "weekday")?.value ?? "";
  if (wk === "Sat" || wk === "Sun") return false;
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const mins = hour * 60 + minute;
  const open = 9 * 60 + 30;
  const close = 16 * 60;
  return mins >= open && mins < close;
}

/** Darken a `#rrggbb` chart background for extended-hours bands. */
export function extendedHoursShadeFromBg(hex: string): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!m) return "rgba(0,0,0,0.2)";
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  const k = 0.72;
  return `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`;
}

/**
 * Pane primitive: draws slightly darker vertical bands during extended hours (outside US RTH).
 */
export function createExtendedHoursShadePrimitive(
  initialShade: string
): IPanePrimitive<Time> & {
  setBarTimesSec: (times: UTCTimestamp[], stepSec: number) => void;
  setShadeColor: (color: string) => void;
} {
  let chart: IChartApiBase<Time> | null = null;
  let requestUpdate: (() => void) | null = null;
  let barTimes: UTCTimestamp[] = [];
  let stepSec = 60;
  let shade = initialShade;

  // Lightweight Charts always invokes `draw` for the foreground pass; `drawBackground` is optional.
  // Keep real work in `draw` so minifiers never drop an empty stub and `draw` is always a function.
  const renderer: IPrimitivePaneRenderer = {
    draw(target) {
      const c = chart;
      if (!c || barTimes.length === 0) return;
      const ts = c.timeScale();
      target.useMediaCoordinateSpace(({ context, mediaSize }) => {
        context.fillStyle = shade;
        const h = mediaSize.height;
        for (let i = 0; i < barTimes.length; i++) {
          const t0 = barTimes[i]!;
          const t0ms = Number(t0) * 1000;
          if (isRegularUsEquityRthEt(t0ms)) continue;
          const t1 = barTimes[i + 1] ?? ((Number(t0) + stepSec) as UTCTimestamp);
          const x0 = ts.timeToCoordinate(t0);
          const x1 = ts.timeToCoordinate(t1);
          if (x0 === null || x1 === null) continue;
          const left = Math.min(x0, x1);
          const w = Math.abs(x1 - x0);
          if (w <= 0.5) continue;
          context.fillRect(left, 0, w, h);
        }
      });
    },
  };

  const paneView: IPanePrimitivePaneView = {
    zOrder: () => "bottom",
    renderer: () => renderer,
  };

  const primitive: IPanePrimitive<Time> & {
    setBarTimesSec: (times: UTCTimestamp[], stepSec: number) => void;
    setShadeColor: (color: string) => void;
  } = {
    attached(param) {
      chart = param.chart;
      requestUpdate = param.requestUpdate;
    },
    detached() {
      chart = null;
      requestUpdate = null;
    },
    paneViews: () => [paneView],
    setBarTimesSec(times: UTCTimestamp[], nextStepSec: number) {
      barTimes = times;
      stepSec = nextStepSec;
      requestUpdate?.();
    },
    setShadeColor(color: string) {
      shade = color;
      requestUpdate?.();
    },
  };

  return primitive;
}
