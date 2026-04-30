"use client";

import { useCallback, useState } from "react";
import type { GapperRow } from "@/types/gappers";
import type { PythonNewsItem } from "@/lib/python-service";
import type { SipCatalystDetailResponse } from "@/types/stocks-in-play";
import type { SipCatalyst } from "@/types/sip-catalyst";
import CollapsibleSection from "@/components/premarket/CollapsibleSection";
import SipPlayRowsTable from "@/components/premarket/SipPlayRowsTable";
import type { SipPersistVariant } from "@/lib/premarket/sip-daily-persistence";

type StocksInPlayProps = {
  sectionLabel?: string;
  collapsed: boolean;
  onToggle: () => void;
  onOpenTickerInLists?: (sym: string) => void;
  largeRows: GapperRow[];
  smallRows: GapperRow[];
  newsByTicker: Record<string, PythonNewsItem[]>;
  catalystByTicker: Record<string, SipCatalyst>;
  onUpsertCatalyst: (ticker: string, detail: SipCatalyst) => void;
  onRemoveFromSip: (target: SipPersistVariant, ticker: string) => void;
};

type CuratedSipBlockProps = {
  title: string;
  sipVariant: SipPersistVariant;
  rows: GapperRow[];
  newsByTicker: Record<string, PythonNewsItem[]>;
  catalystByTicker: Record<string, SipCatalyst>;
  onUpsertCatalyst: (ticker: string, detail: SipCatalyst) => void;
  onRemoveFromSip: (target: SipPersistVariant, ticker: string) => void;
  onOpenTickerInLists?: (sym: string) => void;
  emptyNewsText?: string;
};

function CuratedSipBlock({
  title,
  sipVariant,
  rows,
  newsByTicker,
  catalystByTicker,
  onUpsertCatalyst,
  onRemoveFromSip,
  onOpenTickerInLists,
  emptyNewsText,
}: CuratedSipBlockProps) {
  const [catalystLoadingByTicker, setCatalystLoadingByTicker] = useState<Record<string, boolean>>({});
  const [catalystRequestErrorByTicker, setCatalystRequestErrorByTicker] = useState<Record<string, string | null>>({});
  const [tableCollapsed, setTableCollapsed] = useState(false);

  const requestCatalystForTicker = useCallback(
    async (row: GapperRow): Promise<void> => {
      const ticker = row.ticker.toUpperCase();
      const headlines = (newsByTicker[ticker] ?? []).slice(0, 8);
      if (headlines.length === 0) {
        setCatalystRequestErrorByTicker((prev) => ({ ...prev, [ticker]: "No headlines available for detail generation." }));
        return;
      }
      if (catalystByTicker[ticker]) return;
      if (catalystLoadingByTicker[ticker]) return;

      setCatalystLoadingByTicker((prev) => ({ ...prev, [ticker]: true }));
      setCatalystRequestErrorByTicker((prev) => ({ ...prev, [ticker]: null }));
      try {
        const res = await fetch("/api/premarket/catalyst", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ row, headlines }),
          cache: "no-store",
        });
        const json = (await res.json()) as SipCatalystDetailResponse;
        if (!res.ok || !json.ok) {
          setCatalystRequestErrorByTicker((prev) => ({
            ...prev,
            [ticker]: json.ok ? "Catalyst request failed" : json.error,
          }));
          return;
        }
        const detail = json.catalyst;
        if (!detail) {
          setCatalystRequestErrorByTicker((prev) => ({
            ...prev,
            [ticker]: "No qualifying catalyst details were generated.",
          }));
          return;
        }
        onUpsertCatalyst(ticker, detail);
      } catch (e) {
        setCatalystRequestErrorByTicker((prev) => ({
          ...prev,
          [ticker]: e instanceof Error ? e.message : "Catalyst request failed",
        }));
      } finally {
        setCatalystLoadingByTicker((prev) => ({ ...prev, [ticker]: false }));
      }
    },
    [catalystByTicker, catalystLoadingByTicker, newsByTicker, onUpsertCatalyst]
  );

  return (
    <div className="rounded border" style={{ borderColor: "var(--border-default)", background: "var(--bg-panel)" }}>
      <div className="flex min-w-0 items-center gap-2 rounded-t px-3 py-2" style={{ borderColor: "var(--border-default)" }}>
        <button
          type="button"
          className="pm-focus flex min-w-0 flex-1 items-center gap-2.5 text-left transition-colors duration-150 hover:bg-[rgba(0,229,204,0.09)]"
          onClick={() => setTableCollapsed((v) => !v)}
          aria-expanded={!tableCollapsed}
        >
          <span
            aria-hidden
            className="inline-block shrink-0 leading-none transition-transform duration-200 ease-out"
            style={{
              color: "var(--text-secondary)",
              fontSize: "1.375rem",
              transform: tableCollapsed ? "rotate(0deg)" : "rotate(90deg)",
            }}
          >
            ▸
          </span>
          <span className="pm-site-prose min-w-0 font-semibold" style={{ color: "var(--text-primary)" }}>
            {title}
          </span>
        </button>
      </div>

      {!tableCollapsed ? (
        <div className="space-y-3 border-t p-3" style={{ borderColor: "var(--border-default)" }}>
          {rows.length > 0 ? (
            <SipPlayRowsTable
              rows={rows}
              news={newsByTicker}
              catalyst={catalystByTicker}
              pythonConfigured
              onOpenTickerInLists={onOpenTickerInLists}
              mode="live"
              emptyNewsText={emptyNewsText}
              onRequestCatalyst={requestCatalystForTicker}
              catalystLoadingByTicker={catalystLoadingByTicker}
              catalystRequestErrorByTicker={catalystRequestErrorByTicker}
              onRemoveTicker={(ticker) => onRemoveFromSip(sipVariant, ticker)}
            />
          ) : (
            <p className="pm-site-prose" style={{ color: "var(--text-secondary)" }}>
              No tickers added yet.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default function StocksInPlay({
  sectionLabel = "Stocks in Play",
  collapsed,
  onToggle,
  onOpenTickerInLists,
  largeRows,
  smallRows,
  newsByTicker,
  catalystByTicker,
  onUpsertCatalyst,
  onRemoveFromSip,
}: StocksInPlayProps) {
  return (
    <CollapsibleSection
      id="sip"
      label={sectionLabel}
      labelAccent="cyan"
      collapsed={collapsed}
      onToggle={onToggle}
    >
      {!collapsed ? (
        <div className="space-y-3">
          <CuratedSipBlock
            title="Large Caps"
            sipVariant="mid-large"
            rows={largeRows}
            newsByTicker={newsByTicker}
            catalystByTicker={catalystByTicker}
            onUpsertCatalyst={onUpsertCatalyst}
            onRemoveFromSip={onRemoveFromSip}
            onOpenTickerInLists={onOpenTickerInLists}
          />
          <CuratedSipBlock
            title="Small Caps"
            sipVariant="small-cap"
            rows={smallRows}
            newsByTicker={newsByTicker}
            catalystByTicker={catalystByTicker}
            onUpsertCatalyst={onUpsertCatalyst}
            onRemoveFromSip={onRemoveFromSip}
            emptyNewsText="No News."
            onOpenTickerInLists={onOpenTickerInLists}
          />
        </div>
      ) : null}
    </CollapsibleSection>
  );
}
