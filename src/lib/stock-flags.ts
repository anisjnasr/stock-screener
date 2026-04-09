import type { StockFlag } from "./watchlist-storage";

/** Chart & list table flag picker: blue → purple → yellow → red → green. */
export const FLAG_PICKER_ORDER: StockFlag[] = ["blue", "purple", "yellow", "red", "green"];

export const FLAG_HEX: Record<StockFlag, string> = {
  red: "#EF4468",
  yellow: "#F5A524",
  green: "#3DDC84",
  blue: "#5C9EF5",
  purple: "#A855F7",
};
