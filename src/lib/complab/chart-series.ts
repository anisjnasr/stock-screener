import type { UTCTimestamp } from "lightweight-charts";

export type CompLabCandle = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export function candleTimeToUtcTimestamp(dateStr: string): UTCTimestamp {
  const s = dateStr.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return (new Date(`${s}T12:00:00.000Z`).getTime() / 1000) as UTCTimestamp;
  }
  const ms = Date.parse(s);
  if (Number.isFinite(ms)) {
    return Math.floor(ms / 1000) as UTCTimestamp;
  }
  return (new Date(`${s}T12:00:00.000Z`).getTime() / 1000) as UTCTimestamp;
}

export function timeToDateKey(raw: unknown): string | null {
  if (typeof raw === "number") {
    const ms = Number(raw) * 1000;
    if (!Number.isFinite(ms)) return null;
    return new Date(ms).toISOString().slice(0, 10);
  }
  if (raw && typeof raw === "object" && "year" in raw && "month" in raw && "day" in raw) {
    const t = raw as { year: number; month: number; day: number };
    const mm = String(t.month).padStart(2, "0");
    const dd = String(t.day).padStart(2, "0");
    return `${t.year}-${mm}-${dd}`;
  }
  return null;
}

export function computeEMA(closes: number[], period: number): (number | null)[] {
  if (closes.length === 0 || period < 1) return [];
  const k = 2 / (period + 1);
  const out: (number | null)[] = [];
  let ema: number | null = null;
  for (let i = 0; i < closes.length; i++) {
    const c = closes[i];
    if (i < period - 1) {
      out.push(null);
      continue;
    }
    if (i === period - 1) {
      let sum = 0;
      for (let j = 0; j < period; j++) sum += closes[j]!;
      ema = sum / period;
    } else if (ema !== null) {
      ema = (c - ema) * k + ema;
    }
    out.push(ema);
  }
  return out;
}

export function computeSMA(closes: number[], period: number): (number | null)[] {
  if (closes.length === 0 || period < 1) return [];
  const out: (number | null)[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      out.push(null);
      continue;
    }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += closes[j]!;
    out.push(sum / period);
  }
  return out;
}
