# Render DB Sync Operations

Use this runbook for day-to-day GitHub->Render DB sync and for failure triage.

## Normal flow (async trigger + polling)

1. **Preflight check**
   - `POST /api/admin/sync-db?artifact=daily&preflight=true`
   - `POST /api/admin/sync-db?artifact=ownership&preflight=true`
2. **Async start**
   - `POST /api/admin/sync-db?artifact=daily&wait=false`
3. **Status polling**
   - `GET /api/admin/sync-db`
   - poll until `status.state` is `completed` or `failed`

GitHub workflows already implement this sequence.

## Status payload fields

`GET /api/admin/sync-db` returns:

- `status.state`: `idle | running | completed | failed`
- `status.mode`: `daily | ownership`
- `status.artifact`
- `status.runId`
- `status.startedAt`
- `status.completedAt`
- `status.error`
- `status.dbSizeMb`
- `status.preflightSnapshot`
- `status.manifest`

## Expected timings

- Preflight: ~1-3s
- Async trigger call: ~1-5s
- Full sync (4-5GB DB): typically 10-25 minutes depending on Render IO and load

## Failure triage

1. **Preflight fails with insufficient space**
   - Check:
     - `status.preflightSnapshot.dataFreeMb`
     - `status.preflightSnapshot.requiredMb`
   - Action:
     - increase persistent disk, or
     - perform maintenance cleanup under `/app/data` and retry.

2. **Status reaches failed**
   - Inspect `status.error`.
   - Check Render logs for `[sync-db]`.
   - Confirm artifact/manifest match the same run id.

3. **Polling timeout (no terminal status)**
   - Check if Render restarted mid-sync.
   - Re-query `GET /api/admin/sync-db`; if still `running` for long periods, inspect logs and retrigger.

## Controlled maintenance path (only if needed)

1. Put service in maintenance window.
2. Remove stale files under `/app/data`:
   - `.extract-tmp`
   - `screener.db.staged.*`
   - old backups except latest one
3. Re-run preflight.
4. Trigger async sync and poll status to terminal state.
5. Validate:
   - `/api/health`
   - `/api/init?symbol=SPY`
