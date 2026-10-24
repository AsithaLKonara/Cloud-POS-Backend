#!/usr/bin/env bash
# ==============================================================================
# XONIT Automated Database Backup & Retention Script for Single VPS
# Dumps PostgreSQL database, compresses with gzip, and purges older than 14 days
# ==============================================================================

set -euo pipefail

# Configuration
BACKUP_DIR="${BACKUP_DIR:-/var/backups/xonit}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/xonit_db_${TIMESTAMP}.sql.gz"
LOG_FILE="/var/log/xonit/backup.log"
RETENTION_DAYS=14

# Ensure directories exist
mkdir -p "${BACKUP_DIR}"
mkdir -p "$(dirname "${LOG_FILE}")"

log() {
  echo "[$(date +"%Y-%m-%d %H:%M:%S")] $1" | tee -a "${LOG_FILE}"
}

log "Starting automated database backup..."

# Extract database credentials from Backend/.env if available
ENV_FILE="$(dirname "$0")/../Backend/.env"
if [ -f "${ENV_FILE}" ]; then
  export $(grep -v '^#' "${ENV_FILE}" | grep 'DATABASE_URL' | xargs)
fi

if [ -z "${DATABASE_URL:-}" ]; then
  DATABASE_URL="postgresql://postgres:postgres@localhost:5432/oil_pos_db"
fi

# Execute pg_dump directly through gzip
if pg_dump "${DATABASE_URL}" --clean --if-exists --no-owner --no-privileges | gzip -9 > "${BACKUP_FILE}"; then
  FILE_SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
  log "✓ Backup successfully created: ${BACKUP_FILE} (${FILE_SIZE})"
else
  log "❌ Database backup failed!"
  exit 1
fi

# Rotate backups older than RETENTION_DAYS
log "Pruning backups older than ${RETENTION_DAYS} days..."
find "${BACKUP_DIR}" -name "xonit_db_*.sql.gz" -type f -mtime +${RETENTION_DAYS} -delete
REMAINING_COUNT=$(find "${BACKUP_DIR}" -name "xonit_db_*.sql.gz" -type f | wc -l)
log "✓ Rotation complete. Retaining ${REMAINING_COUNT} snapshot(s)."
log "Backup run finished successfully."
