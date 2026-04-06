#!/bin/sh
set -eu

DATA_DIR="${DATA_DIR:-/app/data}"
DB_PATH="${DB_PATH:-$DATA_DIR/screener.db}"
BACKUP_DIR="${BACKUP_DIR:-$DATA_DIR/backups}"
ZIP_PATH="${1:-}"

mkdir -p "$BACKUP_DIR"

if [ -z "$ZIP_PATH" ]; then
  ZIP_PATH=$(ls -1t "$DATA_DIR"/sync-*.db.zip "$BACKUP_DIR"/*.zip 2>/dev/null | head -1 || true)
fi

if [ -z "$ZIP_PATH" ] || [ ! -f "$ZIP_PATH" ]; then
  echo "No restore zip found. Pass zip path as first arg."
  echo "Example: sh scripts/render-restore-db.sh /app/data/sync-123456789.db.zip"
  exit 1
fi

TS=$(date -u +%Y%m%d-%H%M%S)
BROKEN_BACKUP="$BACKUP_DIR/screener.db.pre-restore.$TS"
EXTRACT_TMP="$DATA_DIR/.restore-tmp-$TS"
STAGED_DB="$DATA_DIR/screener.db.restore-staged.$TS"

echo "[restore] ZIP: $ZIP_PATH"
echo "[restore] DB_PATH: $DB_PATH"

if [ -f "$DB_PATH" ]; then
  cp -f "$DB_PATH" "$BROKEN_BACKUP"
  echo "[restore] Backup created: $BROKEN_BACKUP"
fi

rm -rf "$EXTRACT_TMP"
mkdir -p "$EXTRACT_TMP"

if command -v bsdtar >/dev/null 2>&1; then
  echo "[restore] Extracting with bsdtar..."
  bsdtar xf "$ZIP_PATH" -C "$EXTRACT_TMP"
else
  echo "[restore] Extracting with unzip..."
  unzip -o "$ZIP_PATH" -d "$EXTRACT_TMP"
fi

FOUND_DB=$(find "$EXTRACT_TMP" -type f -name "screener.db" | head -1 || true)
if [ -z "$FOUND_DB" ]; then
  echo "[restore] ERROR: screener.db not found in archive"
  ls -laR "$EXTRACT_TMP" || true
  exit 1
fi

mv "$FOUND_DB" "$STAGED_DB"
rm -rf "$EXTRACT_TMP"

HEADER=$(head -c 15 "$STAGED_DB")
if [ "$HEADER" != "SQLite format 3" ]; then
  echo "[restore] ERROR: invalid SQLite header"
  exit 1
fi

validate_db() {
  DB_TO_CHECK="$1" node -e 'const Database=require("better-sqlite3"); const p=process.env.DB_TO_CHECK; const db=new Database(p,{readonly:true}); const ic=db.prepare("PRAGMA integrity_check").all(); const first=ic[0] && ic[0][Object.keys(ic[0])[0]]; if(first!=="ok"){console.error("integrity_check failed:", first); process.exit(1);} const c=db.prepare("SELECT COUNT(*) c FROM companies").get().c; const d=db.prepare("SELECT MAX(date) d FROM daily_bars").get().d; if(!c||!d){console.error("sanity failed:", c, d); process.exit(1);} console.log(`ok companies=${c} latestDailyBars=${d}`); db.close();'
}

echo "[restore] Validating staged DB..."
validate_db "$STAGED_DB"

echo "[restore] Swapping DB..."
mv -f "$STAGED_DB" "$DB_PATH"
rm -f "$DB_PATH-wal" "$DB_PATH-shm"

echo "[restore] Validating live DB..."
if validate_db "$DB_PATH"; then
  echo "[restore] Success."
else
  echo "[restore] ERROR: live validation failed; rolling back..."
  if [ -f "$BROKEN_BACKUP" ]; then
    cp -f "$BROKEN_BACKUP" "$DB_PATH"
    rm -f "$DB_PATH-wal" "$DB_PATH-shm"
    validate_db "$DB_PATH" || true
  fi
  exit 1
fi

echo "[restore] Done. Restart service, then check /api/health."
