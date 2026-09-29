#!/usr/bin/env bash
#
# Restore a LedgerFlow snapshot. Refuses to overwrite a live database.
#
#   ledgerflow-restore.sh                    # list available snapshots
#   ledgerflow-restore.sh ledgerflow-2026-09-29-03-17-00.db
#   ledgerflow-restore.sh <file> --from-r2   # pull from R2 first, then restore
#
# Backups live on the host at $BACKUP_DIR and inside the container at
# /app/backups, which is the same directory bind-mounted from the host.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/home/ubuntu/ledgerflow/backups}"
CONTAINER="${CONTAINER:-ledgerflow}"
DATA_DIR="/home/ubuntu/docker/ledgerflow-data"

# --- List mode --------------------------------------------------------------
if [ $# -eq 0 ] || [ "${1:-}" = "--list" ]; then
  echo "Available snapshots in ${BACKUP_DIR}:"
  if [ -d "$BACKUP_DIR" ]; then
    ls -lht "$BACKUP_DIR"/ledgerflow-*.db 2>/dev/null || echo "  (none)"
  else
    echo "  (directory does not exist yet)"
  fi
  exit 0
fi

SNAPSHOT="$1"
shift || true
FROM_R2="${1:-}"

# --- Optional pull from R2 --------------------------------------------------
if [ "$FROM_R2" = "--from-r2" ]; then
  echo "Pulling ${SNAPSHOT} from R2..."
  rclone copy "R2:ledgerflow-backups/${SNAPSHOT}" "$BACKUP_DIR" --config /root/.config/rclone/rclone.conf
fi

SNAPSHOT_PATH="$BACKUP_DIR/$SNAPSHOT"
if [ ! -f "$SNAPSHOT_PATH" ]; then
  echo "No such snapshot: ${SNAPSHOT_PATH}" >&2
  exit 1
fi

echo "Verifying ${SNAPSHOT} before touching the live database..."
VERIFY=$(docker run --rm -v "$(dirname "$SNAPSHOT_PATH")":/backups:ro \
  node:22-bookworm-slim node -e '
    const D = require("better-sqlite3");
    const db = new D("/backups/" + process.argv[1], { readonly: true, fileMustExist: true });
    const r = db.pragma("integrity_check", { simple: true });
    const u = db.prepare("SELECT COUNT(*) n FROM users").get().n;
    console.log(r + " users=" + u);
  ' "$SNAPSHOT")

if [[ "$VERIFY" != ok\ * ]]; then
  echo "Snapshot failed verification (${VERIFY}). Refusing to restore." >&2
  exit 1
fi
echo "  verified: ${VERIFY}"

read -r -p "This overwrites the live database. Type 'restore' to continue: " CONFIRM
if [ "$CONFIRM" != "restore" ]; then
  echo "Aborted."
  exit 1
fi

# Keep a copy of whatever is live right now, so a restore is itself reversible.
STAMP=$(date -u +%Y-%m-%dT%H-%M-%SZ)
if [ -f "${DATA_DIR}/accounting.db" ]; then
  echo "Preserving the current database as pre-restore-${STAMP}.db"
  docker run --rm -v "$DATA_DIR":/data -v "$BACKUP_DIR":/backups \
    node:22-bookworm-slim node -e '
      const D = require("better-sqlite3");
      const db = new D("/data/accounting.db", { readonly: true, fileMustExist: true });
      db.backup("/backups/pre-restore-" + process.argv[1] + ".db").then(() => console.log("  saved"));
    ' "$STAMP"
fi

echo "Stopping ${CONTAINER}..."
docker stop "$CONTAINER" >/dev/null 2>&1 || true

# WAL sidecars belong to the old database. Leaving them behind would let a
# recovery replay the previous journal over the restored file.
rm -f "${DATA_DIR}/accounting.db-wal" "${DATA_DIR}/accounting.db-shm"
cp "$SNAPSHOT_PATH" "${DATA_DIR}/accounting.db"
chown 999:999 "${DATA_DIR}/accounting.db" 2>/dev/null || true
chmod 600 "${DATA_DIR}/accounting.db" 2>/dev/null || true

echo "Starting ${CONTAINER}..."
docker start "$CONTAINER" >/dev/null

sleep 3
if docker exec "$CONTAINER" node -e 'process.exit(0)' 2>/dev/null; then
  echo "Restore complete. ${CONTAINER} is running."
else
  echo "Restore finished but ${CONTAINER} failed to start. Check: docker logs ${CONTAINER}" >&2
  exit 1
fi
