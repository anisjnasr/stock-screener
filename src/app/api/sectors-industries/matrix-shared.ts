/** Matrix timeframe keys (align with `PerformanceTimeframe` in screener-db-native). */
export type MatrixTfKey = "day" | "week" | "month" | "quarter" | "half_year" | "year" | "ytd";

export const MATRIX_PERF_TF: MatrixTfKey[] = [
  "day",
  "week",
  "month",
  "quarter",
  "half_year",
  "year",
  "ytd",
];

export type MatrixPerfMap = Record<MatrixTfKey, number | null>;

export type MatrixRow = {
  id: string;
  name: string;
  ticker: string;
  drillKind: "sector" | "industry" | "theme";
  drillValue: string;
  perf: MatrixPerfMap;
};

export type SectorsMatrixPayload = {
  matrix: true;
  version: number;
  date: string | null;
  sectors: MatrixRow[];
  industries: MatrixRow[];
};
