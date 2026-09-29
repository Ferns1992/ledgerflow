/**
 * Nightly SQLite snapshot for LedgerFlow.
 *
 * Run inside the container, where the database and the native better-sqlite3
 * binding both live:
 *
 *   docker exec ledgerflow node scripts/backup.mjs
 *
 * Why not just copy the file? The database runs in WAL mode, so recent writes
 * live in `accounting.db-wal` and are not yet merged into the main file. A
 * plain `cp` of a live database can capture a torn state that fails to open.
 * better-sqlite3 exposes SQLite's online backup API, which takes a consistent
 * snapshot through a read transaction while the app keeps running.
 *
 * Every snapshot is verified with PRAGMA integrity_check before it is accepted.
 * A backup that cannot be opened is worse than no backup, because it looks
 * like a safety net until the day it is needed.
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DB_PATH = process.env.DB_PATH || '/app/data/accounting.db';
const BACKUP_DIR = process.env.BACKUP_DIR || '/app/backups';
const RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS || 30);
const STAMP = process.env.BACKUP_STAMP || new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

const stamp = () => new Date().toISOString();

function die(message, err) {
  console.error(`[backup] FAILED at ${stamp()}: ${message}`);
  if (err) console.error(`[backup] cause: ${err.stack || err.message || err}`);
  process.exit(1);
}

if (!fs.existsSync(DB_PATH)) die(`database not found at ${DB_PATH}`);

fs.mkdirSync(BACKUP_DIR, { recursive: true });

const target = path.join(BACKUP_DIR, `ledgerflow-${STAMP}.db`);
const tempTarget = `${target}.partial`;

console.log(`[backup] ${stamp()} snapshotting ${DB_PATH} -> ${target}`);

let db;
let backupDb;
try {
  db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  backupDb = new Database(tempTarget);

  // The online backup API. `pagesPerStep` trades a little speed for a smaller
  // working set, which matters on a 1 GB box.
  await db.backup(backupDb, { pagesPerStep: 256 });

  // Verify before accepting. Reopening is the real test: it proves the file is
  // not truncated and that every page parses.
  backupDb.close();
  backupDb = new Database(tempTarget, { readonly: true, fileMustExist: true });

  const integrity = backupDb.pragma('integrity_check', { simple: true });
  if (integrity !== 'ok') die(`integrity_check returned "${integrity}"`);

  const rowCount = backupDb.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const companyCount = backupDb.prepare('SELECT COUNT(*) AS n FROM companies').get().n;
  const voucherCount = backupDb.prepare('SELECT COUNT(*) AS n FROM transactions').get().n;

  backupDb.close();
  backupDb = undefined;

  // Only now is the file allowed to take its final name.
  fs.renameSync(tempTarget, target);

  const sizeKb = Math.round(fs.statSync(target).size / 1024);
  console.log(
    `[backup] ${stamp()} ok: ${sizeKb} kB, integrity ok, ` +
      `${rowCount} user(s), ${companyCount} company(ies), ${voucherCount} voucher(s)`,
  );
} catch (err) {
  try {
    if (backupDb) backupDb.close();
  } catch {
    /* already closed */
  }
  try {
    if (fs.existsSync(tempTarget)) fs.unlinkSync(tempTarget);
  } catch {
    /* best effort */
  }
  die('snapshot did not complete', err);
} finally {
  try {
    if (db) db.close();
  } catch {
    /* best effort */
  }
}

// --- Retention -------------------------------------------------------------
// Only after a verified snapshot exists is it safe to drop old ones.
const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
let removed = 0;
for (const name of fs.readdirSync(BACKUP_DIR)) {
  if (!name.startsWith('ledgerflow-') || !name.endsWith('.db')) continue;
  const file = path.join(BACKUP_DIR, name);
  try {
    if (fs.statSync(file).mtimeMs < cutoff) {
      fs.unlinkSync(file);
      removed++;
    }
  } catch {
    /* skip files we cannot stat */
  }
}
if (removed > 0) {
  console.log(`[backup] ${stamp()} pruned ${removed} snapshot(s) older than ${RETENTION_DAYS} days`);
}

const kept = fs.readdirSync(BACKUP_DIR).filter((n) => n.endsWith('.db'));
console.log(`[backup] ${stamp()} done, ${kept.length} snapshot(s) retained in ${BACKUP_DIR}`);
