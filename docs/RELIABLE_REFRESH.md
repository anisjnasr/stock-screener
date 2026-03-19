# Reliable Refresh Architecture

This guide defines the production-safe refresh strategy for `screener.db`.

## Why this exists

Running heavy refresh jobs directly against the live DB can cause:

- partial data states (some tables updated, others stale)
- app instability during long-running operations
- memory-related restarts on smaller hosts

## Recommended pattern

Use the staged pipeline:

```bash
npm run refresh-safe
```

It does:

1. Copy active DB to a staged DB file.
2. Run refresh scripts against staged DB (`refresh-daily`, `refresh-financials`, `refresh-ownership`).
3. Verify staged DB has healthy quote/financial/ownership data.
4. Promote staged DB into place.
5. Keep timestamped backup in `data/backups/`.

If atomic rename is blocked (common on Windows), it falls back to SQLite backup promotion.

## Common modes

Light ownership update:

```bash
npm run refresh-safe -- --skip-daily --ownership-latest-only
```

Financials-only staged refresh:

```bash
npm run refresh-safe -- --skip-daily --skip-ownership
```

Skip ownership entirely:

```bash
npm run refresh-safe -- --skip-ownership
```

## Health gating

`/api/health` now includes readiness checks:

- `checks.ownershipHealthy`
- `checks.financialsHealthy`

By default, the endpoint returns HTTP `503` if required datasets are missing.

Env overrides:

- `HEALTH_REQUIRE_OWNERSHIP=0` to disable ownership requirement
- `HEALTH_REQUIRE_FINANCIALS=0` to disable financials requirement

## Scheduling guidance

- Prefer off-hours scheduling.
- Prefer a separate worker/scheduler from web traffic where your platform supports shared storage.
- If running on the same service/container, use lightweight modes first and scale instance memory during full refresh windows.

## Incident recovery

If refresh fails:

1. Check logs for the failing stage.
2. Confirm active DB still serves with `/api/health`.
3. Retry in lighter mode (`--ownership-latest-only`).
4. Restore from latest backup in `data/backups/` if needed.

