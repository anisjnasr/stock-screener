/**
 * Ask the Python service to pull the current screener.db from this app.
 * No-op when Python is not configured. Never throws — logs and returns.
 */
export async function triggerPythonScreenerDbSync(opts?: {
  wait?: boolean;
  reason?: string;
}): Promise<{ ok: boolean; skipped?: boolean; error?: string; status?: string }> {
  const base = process.env.PYTHON_SERVICE_URL?.trim();
  const key = process.env.PYTHON_SERVICE_KEY?.trim();
  if (!base || !key) {
    console.log("[python-db-sync] skipped: PYTHON_SERVICE_URL or PYTHON_SERVICE_KEY not set");
    return { ok: false, skipped: true, error: "python_service_not_configured" };
  }

  const wait = opts?.wait === true;
  const url = `${base.replace(/\/$/, "")}/admin/sync-screener-db${wait ? "?wait=true" : "?wait=false"}`;
  const reason = opts?.reason?.trim();

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: reason ? JSON.stringify({ reason }) : "{}",
      cache: "no-store",
    });
    const text = await res.text();
    let parsed: { ok?: boolean; status?: string; error?: string; detail?: string } = {};
    try {
      parsed = JSON.parse(text) as typeof parsed;
    } catch {
      /* ignore */
    }
    if (!res.ok) {
      const msg = parsed.detail || parsed.error || text.slice(0, 400);
      console.error(`[python-db-sync] HTTP ${res.status}: ${msg}`);
      return { ok: false, error: msg, status: parsed.status };
    }
    console.log(`[python-db-sync] ${parsed.status ?? "ok"}${reason ? ` (${reason})` : ""}`);
    return { ok: parsed.ok !== false, status: parsed.status, error: parsed.error };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[python-db-sync] failed: ${msg}`);
    return { ok: false, error: msg };
  }
}
