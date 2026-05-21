"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  calendarMonthStart,
  daysInMonth,
  formatPartialReferenceDateInput,
  formatReferenceDateDisplay,
  isoFromCalendarParts,
  isSelectableReferenceDate,
  parseReferenceDateInput,
  referenceDateInputCaret,
  referenceDateInputDigits,
  referenceDateInvalidReason,
  type ReferenceDateContext,
} from "@/lib/complab/reference-dates";

type Props = {
  referenceDate: string | null;
  onReferenceDateChange: (date: string | null) => void;
  dateContext: ReferenceDateContext | null;
  disabled?: boolean;
};

const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function monthLabel(year: number, month: number): string {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default function CompLabReferenceDateField({
  referenceDate,
  onReferenceDateChange,
  dateContext,
  disabled = false,
}: Props) {
  const [textValue, setTextValue] = useState(referenceDate ? formatReferenceDateDisplay(referenceDate) : "");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const setInputCaret = (digitCount: number) => {
    window.requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      const caret = referenceDateInputCaret(digitCount);
      input.setSelectionRange(caret, caret);
    });
  };

  const initialMonth = useMemo(() => {
    const anchor = referenceDate ?? dateContext?.latestSelectableDate ?? dateContext?.todayEt;
    if (!anchor) return calendarMonthStart(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1);
    const [y, m] = anchor.split("-").map(Number);
    return calendarMonthStart(y!, m!);
  }, [dateContext?.latestSelectableDate, dateContext?.todayEt, referenceDate]);

  const [viewYear, setViewYear] = useState(initialMonth.year);
  const [viewMonth, setViewMonth] = useState(initialMonth.month);

  useEffect(() => {
    setTextValue(referenceDate ? formatReferenceDateDisplay(referenceDate) : "");
    setError(null);
  }, [referenceDate]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const tryCommit = (raw: string) => {
    if (!dateContext) return;
    const trimmed = raw.trim();
    if (!trimmed) {
      onReferenceDateChange(null);
      setError(null);
      return;
    }
    const iso = parseReferenceDateInput(trimmed);
    if (!iso) {
      setError("Use dd-mm-yyyy");
      return;
    }
    const invalid = referenceDateInvalidReason(iso, dateContext);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    onReferenceDateChange(iso);
    setOpen(false);
  };

  const monthCells = useMemo(() => {
    const firstDow = new Date(Date.UTC(viewYear, viewMonth - 1, 1)).getUTCDay();
    const totalDays = daysInMonth(viewYear, viewMonth);
    const cells: Array<{ day: number | null; iso: string | null }> = [];
    for (let i = 0; i < firstDow; i++) cells.push({ day: null, iso: null });
    for (let day = 1; day <= totalDays; day++) {
      cells.push({ day, iso: isoFromCalendarParts(viewYear, viewMonth, day) });
    }
    return cells;
  }, [viewMonth, viewYear]);

  return (
    <div ref={rootRef} className="relative flex flex-wrap items-center gap-3">
      <label
        className="text-xs font-semibold uppercase tracking-wider"
        style={{ color: "var(--ws-text-dim)" }}
        htmlFor="comp-lab-reference-date"
      >
        Reference date
      </label>
      <div className="relative inline-flex items-center">
        <input
          ref={inputRef}
          id="comp-lab-reference-date"
          type="text"
          inputMode="numeric"
          disabled={disabled || !dateContext}
          value={textValue}
          placeholder={focused ? "" : "dd-mm-yyyy"}
          onChange={(e) => {
            const digits = referenceDateInputDigits(e.target.value);
            const display = formatPartialReferenceDateInput(digits);
            setTextValue(display);
            setInputCaret(digits.length);
          }}
          onFocus={() => {
            setFocused(true);
            setOpen(true);
            setInputCaret(referenceDateInputDigits(textValue).length);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              tryCommit(textValue);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          onBlur={() => {
            setFocused(false);
            window.setTimeout(() => {
              if (!open) tryCommit(textValue);
            }, 120);
          }}
          className="h-8 w-[9.5rem] rounded px-2 py-0 text-center text-sm leading-8 tabular-nums"
          style={{
            background: "var(--ws-bg3)",
            color: "var(--ws-text)",
            border: `1px solid ${error ? "var(--ws-red, #ef4444)" : "var(--ws-border)"}`,
          }}
          aria-label="Reference date"
          aria-invalid={error ? true : undefined}
        />
        {referenceDate && (
          <button
            type="button"
            className="ml-2 text-xs underline"
            style={{ color: "var(--ws-text-dim)" }}
            onClick={() => {
              setTextValue("");
              setError(null);
              onReferenceDateChange(null);
            }}
          >
            Clear
          </button>
        )}
        {open && dateContext && (
          <div
            className="absolute left-0 top-full z-[130] mt-2 w-[17rem] rounded border p-3 shadow-lg"
            style={{ background: "var(--ws-bg2)", borderColor: "var(--ws-border-hover)" }}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <button
                type="button"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-lg leading-none"
                style={{ color: "var(--ws-text)" }}
                aria-label="Previous month"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  const prev = calendarMonthStart(viewYear, viewMonth - 1);
                  setViewYear(prev.year);
                  setViewMonth(prev.month);
                }}
              >
                ‹
              </button>
              <span className="text-xs font-semibold" style={{ color: "var(--ws-text)" }}>
                {monthLabel(viewYear, viewMonth)}
              </span>
              <button
                type="button"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-lg leading-none"
                style={{ color: "var(--ws-text)" }}
                aria-label="Next month"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  const next = calendarMonthStart(viewYear, viewMonth + 1);
                  setViewYear(next.year);
                  setViewMonth(next.month);
                }}
              >
                ›
              </button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-[10px]" style={{ color: "var(--ws-text-dim)" }}>
              {WEEKDAY_LABELS.map((d) => (
                <div key={d} className="py-0.5">
                  {d}
                </div>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1">
              {monthCells.map((cell, idx) => {
                if (cell.day == null || !cell.iso) {
                  return <div key={`empty-${idx}`} className="h-7" />;
                }
                const selectable = isSelectableReferenceDate(cell.iso, dateContext);
                const selected = referenceDate === cell.iso;
                return (
                  <button
                    key={cell.iso}
                    type="button"
                    disabled={!selectable}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      if (!selectable) return;
                      onReferenceDateChange(cell.iso);
                      setTextValue(formatReferenceDateDisplay(cell.iso!));
                      setError(null);
                      setOpen(false);
                    }}
                    className="h-7 rounded text-xs"
                    style={{
                      color: selectable ? "var(--ws-text)" : "var(--ws-text-vdim)",
                      opacity: selectable ? 1 : 0.35,
                      background: selected ? "rgba(61, 220, 132, 0.25)" : "transparent",
                      border: selected ? "1px solid var(--ws-green)" : "1px solid transparent",
                      cursor: selectable ? "pointer" : "not-allowed",
                    }}
                  >
                    {cell.day}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
      {error && (
        <span className="text-xs" style={{ color: "var(--ws-red, #ef4444)" }} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
