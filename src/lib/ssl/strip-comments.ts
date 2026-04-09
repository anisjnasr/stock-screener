/** Strips line and block comments before lexing; preserves newlines for error line numbers. */
export function stripSslComments(source: string): string {
  let out = "";
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i]!;
    if (c === "/" && i + 1 < n && source[i + 1] === "/") {
      i += 2;
      while (i < n && source[i] !== "\n") i++;
      if (i < n && source[i] === "\n") {
        out += "\n";
        i++;
      }
      continue;
    }
    if (c === "/" && i + 1 < n && source[i + 1] === "*") {
      i += 2;
      while (i + 1 < n && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i = Math.min(i + 2, n);
      out += " ";
      continue;
    }
    if (c === '"' || c === "'") {
      const q = c;
      out += q;
      i++;
      while (i < n && source[i] !== q) {
        out += source[i]!;
        i++;
      }
      if (i < n) {
        out += source[i]!;
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}
