#!/usr/bin/env bash
# ==============================================================================
# XONIT POS & ERP - Automated Database Backup & Retention Daemon
# Hardware Profile: 4 vCPU Cores | 8 GB RAM | 100 GB SSD
# ==============================================================================

set -euo pipefail

# Configuration
DEFAULT_BACKUP_DIR="/var/backups/xonit"
if [ ! -w "/var" ] && [ ! -d "/var/backups/xonit" ]; then
  DEFAULT_BACKUP_DIR="$(cd "$(dirname "$0")/.." && pwd)/backups"
fi
BACKUP_DIR="${BACKUP_DIR:-$DEFAULT_BACKUP_DIR}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/xonit_db_${TIMESTAMP}.sql.gz"

DEFAULT_LOG_FILE="/var/log/xonit/backup.log"
if [ ! -w "/var/log" ] && [ ! -d "/var/log/xonit" ]; then
  DEFAULT_LOG_FILE="$(cd "$(dirname "$0")/.." && pwd)/logs/backup.log"
fi
LOG_FILE="${LOG_FILE:-$DEFAULT_LOG_FILE}"
RETENTION_DAYS=14

mkdir -p "${BACKUP_DIR}"
mkdir -p "$(dirname "${LOG_FILE}")"

log() {
  echo "[$(date +"%Y-%m-%d %H:%M:%S")] $1" | tee -a "${LOG_FILE}"
}

log "======================================================"
log "Starting scheduled PostgreSQL database backup..."

# Extract database credentials from Backend/.env if available
ENV_FILE="$(dirname "$0")/../Backend/.env"
if [ -f "${ENV_FILE}" ]; then
  # Read DATABASE_URL safely
  DATABASE_URL=$(grep -E '^DATABASE_URL=' "${ENV_FILE}" | cut -d '=' -f2- | tr -d '"' | tr -d "'" || true)
fi

if [ -z "${DATABASE_URL:-}" ]; then
  DATABASE_URL="postgresql://xonit_user:password@127.0.0.1:5432/xonit_pos_db"
fi

# Execute pg_dump directly through high-compression gzip
if pg_dump "${DATABASE_URL}" --clean --if-exists --no-owner --no-privileges | gzip -9 > "${BACKUP_FILE}"; then
  FILE_SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
  log "✓ Backup successfully created: ${BACKUP_FILE} (${FILE_SIZE})"
else
  log "❌ PostgreSQL dump failed! Verify credentials in Backend/.env"
  exit 1
fi

# Rotate backups older than RETENTION_DAYS to safeguard 100GB SSD
log "Purging backup snapshots older than ${RETENTION_DAYS} days..."
find "${BACKUP_DIR}" -name "xonit_db_*.sql.gz" -type f -mtime +${RETENTION_DAYS} -delete
REMAINING_COUNT=$(find "${BACKUP_DIR}" -name "xonit_db_*.sql.gz" -type f | wc -l)
log "✓ Retention rotation complete. Retaining ${REMAINING_COUNT} snapshot(s)."

# Check remaining disk space on 100GB SSD
DISK_USAGE=$(df -h "${BACKUP_DIR}" | awk 'NR==2 {print $5}')
log "Disk capacity used on root volume: ${DISK_USAGE}"
log "Database backup process completed successfully."
log "======================================================"
