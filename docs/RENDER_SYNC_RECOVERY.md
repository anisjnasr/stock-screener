# Render DB Sync Controlled Recovery

Use this runbook only when `/api/admin/sync-db?preflight=true` reports
insufficient disk for a safe staged swap.

## 1) Confirm preflight failure

Run from GitHub Actions (already wired in workflow) or manually:

- `POST /api/admin/sync-db?artifact=daily&preflight=true`
- `POST /api/admin/sync-db?artifact=ownership&preflight=true`

Confirm:

- `snapshot.enoughSpace` is `false`
- `snapshot.dataFreeMb` is lower than `snapshot.requiredMb`

## 2) Preferred fix: increase persistent disk

In Render service settings, increase persistent disk size so preflight can pass
without risky mutation paths.

Target baseline:

- `requiredMb + 1024` free space after startup.

## 3) One-time controlled maintenance (if disk cannot be resized immediately)

1. Put service in maintenance window (pause external traffic).
2. Remove stale files under `/app/data`:
   - `.extract-tmp`
   - `screener.db.staged.*`
   - old backups except latest one
3. Re-run preflight endpoint.
4. If preflight passes, run:
   - `POST /api/admin/sync-db?artifact=daily&wait=true`
5. Restart service after completion.
6. Validate:
   - `/api/health`
   - `/api/init?symbol=SPY`

If preflight still fails after cleanup, do not run sync. Resize disk first.
