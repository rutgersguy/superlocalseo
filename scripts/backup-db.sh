#!/usr/bin/env bash
# Daily PostgreSQL backup — keeps 30 days of snapshots.
# Run via cron: 0 2 * * * /opt/superlocalseo/scripts/backup-db.sh >> /var/log/superlocalseo-backup.log 2>&1

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/superlocalseo}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILENAME="superlocalseo_${TIMESTAMP}.sql.gz"

# Load .env if present and DATABASE_URL not already set
if [[ -z "${DATABASE_URL:-}" && -f "/opt/superlocalseo/.env" ]]; then
  export $(grep -E '^DATABASE_URL=' /opt/superlocalseo/.env | xargs)
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "[$(date -Is)] ERROR: DATABASE_URL not set" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

echo "[$(date -Is)] Starting backup → $BACKUP_DIR/$FILENAME"

pg_dump "$DATABASE_URL" | gzip > "$BACKUP_DIR/$FILENAME"

echo "[$(date -Is)] Backup complete: $(du -sh "$BACKUP_DIR/$FILENAME" | cut -f1)"

# Prune backups older than RETENTION_DAYS
PRUNED=$(find "$BACKUP_DIR" -name "superlocalseo_*.sql.gz" -mtime "+${RETENTION_DAYS}" -print -delete | wc -l)
echo "[$(date -Is)] Pruned $PRUNED backup(s) older than ${RETENTION_DAYS} days"
