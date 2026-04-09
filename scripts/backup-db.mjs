#!/usr/bin/env node
/**
 * Consistent SQLite file backup using better-sqlite3 backup API.
 *
 * Usage:
 *   node scripts/backup-db.mjs --from pathA.db --to pathB.db
 */

import Database from "better-sqlite3";
import { existsSync } from "fs";
import { dirname, resolve } from "path";
import { mkdirSync } from "fs";

function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : null;
}

const fromArg = getArg("--from");
const toArg = getArg("--to");

if (!fromArg || !toArg) {
  console.error("Usage: node scripts/backup-db.mjs --from <source.db> --to <dest.db>");
  process.exit(1);
}

const fromPath = resolve(fromArg);
const toPath = resolve(toArg);

if (!existsSync(fromPath)) {
  console.error(`Source DB does not exist: ${fromPath}`);
  process.exit(1);
}

mkdirSync(dirname(toPath), { recursive: true });

const src = new Database(fromPath, { readonly: true });
try {
  await src.backup(toPath);
  console.log(
    JSON.stringify(
      {
        ok: true,
        from: fromPath,
        to: toPath,
      },
      null,
      2
    )
  );
} finally {
  src.close();
}

