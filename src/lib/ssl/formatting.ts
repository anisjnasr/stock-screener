import { tokenize } from "./tokens";

/**
 * Normalize only SSL language tokens that have canonical uppercase spelling.
 * User variables, field text that is not recognized by the highlighter, strings,
 * and comments keep the user's casing.
 */
export function normalizeSslText(raw: string): string {
  const lines = raw.split("\n");
  return lines
    .map((line) =>
      tokenize(line)
        .map((token) => {
          if (token.type === "keyword" || token.type === "function" || token.type === "operator") {
            return token.value.toUpperCase();
          }
          return token.value;
        })
        .join("")
    )
    .join("\n");
}
