/** Pull `addr@host` from a RFC5322 From header (handles `Name <addr>`). */
export function parseEmailAddressFromFromHeader(from: string): string | null {
  const t = from.trim();
  if (!t) return null;
  const m = t.match(/<([^>\s]+@[^>\s]+)>/i);
  if (m?.[1]) return m[1].trim().toLowerCase();
  if (/^[^\s<]+@[^\s>]+$/.test(t)) return t.toLowerCase();
  const loose = t.match(/([^\s<>]+@[^\s<>]+)/);
  return loose?.[1]?.trim().toLowerCase() ?? null;
}
