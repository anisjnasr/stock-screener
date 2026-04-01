import { THEMATIC_ETFS } from "@/lib/thematic-etfs";

/** GICS-style industry label → liquid sector/industry ETF (single representative ticker). */
export const INDUSTRY_ETF_MAP: Record<string, string> = {
  "Aerospace & Defense": "ITA",
  Airlines: "JETS",
  "Auto Manufacturers": "CARZ",
  "Banks - Diversified": "KBE",
  "Banks - Regional": "KRE",
  "Packaged Foods": "PBJ",
  Biotechnology: "XBI",
  "Capital Markets": "KCE",
  "Pharmaceutical Retailers": "XPH",
  Gambling: "BETZ",
  Gold: "GDX",
  "Health Care Providers": "IHF",
  "Residential Construction": "ITB",
  "Insurance - Diversified": "KIE",
  "Medical Devices": "IHI",
  Steel: "XME",
  "Oil & Gas E&P": "XOP",
  "REIT - Diversified": "VNQ",
  Semiconductors: "SMH",
  "Software - Infrastructure": "IGV",
  "Specialty Retail": "XRT",
  "Telecom Services": "IYZ",
  "Integrated Freight & Logistics": "IYT",
};

export type IndustryEtfUniverseRow = {
  id: string;
  /** Canonical label: GICS industry string or thematic theme name (for display + industry drill matching). */
  name: string;
  ticker: string;
  drillKind: "industry" | "theme";
  /** GICS industry name when drillKind is industry; thematic `id` when drillKind is theme. */
  drillValue: string;
};

function toSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const industryRows: IndustryEtfUniverseRow[] = Object.entries(INDUSTRY_ETF_MAP).map(([name, ticker]) => ({
  id: toSlug(name),
  name,
  ticker,
  drillKind: "industry",
  drillValue: name,
}));

const industryTickerSet = new Set(Object.values(INDUSTRY_ETF_MAP));

const thematicOnlyRows: IndustryEtfUniverseRow[] = THEMATIC_ETFS.filter((t) => !industryTickerSet.has(t.ticker)).map(
  (t) => ({
    id: t.id,
    name: t.theme,
    ticker: t.ticker,
    drillKind: "theme",
    drillValue: t.id,
  })
);

/** Industry ETF map plus thematic-only ETFs, deduped by ticker (industry label wins). */
export const INDUSTRY_ETF_UNIVERSE: IndustryEtfUniverseRow[] = [...industryRows, ...thematicOnlyRows].sort((a, b) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
);

export const INDUSTRY_ETF_UNIVERSE_TICKERS: string[] = [
  ...new Set(INDUSTRY_ETF_UNIVERSE.map((r) => r.ticker.toUpperCase())),
];
