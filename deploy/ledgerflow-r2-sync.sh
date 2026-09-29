#!/usr/bin/env bash
#
# Off-site mirror for LedgerFlow snapshots.
#
# Runs on the host, never inside the container, so the R2 credentials in
# /root/.config/rclone/rclone.conf are not reachable by anything the web app
# can touch. Uses `copy`, never `sync`: a partial upload must not be able to
# delete the remote history.
set -euo pipefail

BUCKET="${LEDGERFLOW_R2_BUCKET:-ledgerflow-backups}"
LOCAL_DIR="${BACKUP_DIR:-/home/ubuntu/ledgerflow/backups}"
KEEP_REMOTE="${KEEP_REMOTE:-30}"
RCLONE_CONF="${RCLONE_CONF:-/root/.config/rclone/rclone.conf}"

if [ ! -d "$LOCAL_DIR" ]; then
  echo "ledgerflow-r2-sync: $LOCAL_DIR does not exist, nothing to mirror" >&2
  exit 0
fi

COUNT=$(find "$LOCAL_DIR" -maxdepth 1 -name 'ledgerflow-*.db' | wc -l | tr -d ' ')
if [ "$COUNT" -eq 0 ]; then
  echo "ledgerflow-r2-sync: no snapshots in $LOCAL_DIR, skipping" >&2
  exit 0
fi

echo "ledgerflow-r2-sync: mirroring ${COUNT} snapshot(s) to R2:${BUCKET}"

rclone copy "$LOCAL_DIR" "R2:${BUCKET}" \
  --config "$RCLONE_CONF" \
  --filter '+ ledgerflow-*.db' --filter '- **' \
  --transfers 2 \
  --checkers 4 \
  --retries 3 \
  --low-level-retries 10 \
  --stats 30s \
  --log-level INFO

# Retention on the remote is independent of the local one, so a botched local
# prune cannot quietly shrink the off-site history.
echo "ledgerflow-r2-sync: applying remote retention (keep newest ${KEEP_REMOTE})"
rclone delete "R2:${BUCKET}" \
  --config "$RCLONE_CONF" \
  --filter '+ ledgerflow-*.db' --filter '- **' \
  --min-age "${KEEP_REMOTE}d" \
  --dry-run \
  --log-level INFO

# Only after a successful upload is pruning allowed to remove anything remote.
rclone delete "R2:${BUCKET}" \
  --config "$RCLONE_CONF" \
  --filter '+ ledgerflow-*.db' --filter '- **' \
  --min-age "${KEEP_REMOTE}d" \
  --log-level INFO

REMOTE_COUNT=$(rclone size "R2:${BUCKET}" --config "$RCLONE_CONF" --json 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin).get("count",0))' 2>/dev/null || echo "?")
echo "ledgerflow-r2-sync: done, ${REMOTE_COUNT} object(s) in R2:${BUCKET}"
