"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CalendarEventFlagType, CalendarFlagReason } from "@/types/calendar-event-flags";

const REASONS: { reason: CalendarFlagReason; label: string }[] = [
  { reason: "not_relevant", label: "Not relevant" },
  { reason: "wrong_timing", label: "Wrong timing / info" },
  { reason: "duplicate", label: "Duplicate" },
  { reason: "too_noisy", label: "Too noisy" },
];

type EventRowFlagProps = {
  eventType: CalendarEventFlagType;
  eventId: string;
  onFlagged: () => void;
};

export default function EventRowFlag({ eventType, eventId, onFlagged }: EventRowFlagProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const submit = useCallback(
    async (reason: CalendarFlagReason) => {
      setBusy(true);
      try {
        const res = await fetch("/api/events/flag", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ eventType, eventId, reason }),
        });
        const json = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok || !json.ok) {
          console.error("[EventRowFlag]", json.error ?? res.statusText);
          return;
        }
        setOpen(false);
        onFlagged();
      } finally {
        setBusy(false);
      }
    },
    [eventId, eventType, onFlagged]
  );

  return (
    <div ref={rootRef} className="relative flex shrink-0 justify-end">
      <button
        type="button"
        disabled={busy}
        onClick={() => setOpen((o) => !o)}
        className="rounded p-1 opacity-100 transition-opacity ws-focus-ring sm:opacity-0 sm:group-hover:opacity-100"
        style={{ color: "var(--ws-text-dim)" }}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Flag this row"
        title="Flag"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M4 15V4h12l-2 4 2 4H6v7H4v-4z"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open ? (
        <div
          className="absolute right-0 top-full z-20 mt-0.5 min-w-[11rem] rounded border py-1 shadow-lg"
          style={{ borderColor: "var(--ws-border)", background: "var(--ws-bg2)" }}
          role="menu"
        >
          {REASONS.map(({ reason, label }) => (
            <button
              key={reason}
              type="button"
              role="menuitem"
              disabled={busy}
              className="block w-full px-2.5 py-1.5 text-left text-[11px] leading-snug transition-colors hover:bg-[color:var(--ws-hover)]"
              style={{ color: "var(--ws-text)" }}
              onClick={() => void submit(reason)}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
