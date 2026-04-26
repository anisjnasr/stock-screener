import type { SectorsMatrixPayload } from "@/app/api/sectors-industries/matrix-shared";

let inflight: Promise<SectorsMatrixPayload | null> | null = null;
let resolved: SectorsMatrixPayload | null = null;

/** Start loading sectors matrix (safe to call multiple times). */
export function prefetchSectorsMatrix(): Promise<SectorsMatrixPayload | null> {
  if (resolved) return Promise.resolve(resolved);
  if (inflight) return inflight;
  inflight = fetch("/api/sectors-industries?view=matrix", { cache: "no-store" })
    .then(async (r) => {
      if (!r.ok) return null;
      const j = (await r.json()) as SectorsMatrixPayload & { error?: string };
      if (j.error || !j.matrix) return null;
      resolved = j;
      return j;
    })
    .catch(() => null)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function getCachedSectorsMatrix(): SectorsMatrixPayload | null {
  return resolved;
}
