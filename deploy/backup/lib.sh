#!/usr/bin/env bash
# Shared by the backup commands. Everything comes from environment variables (deploy/.env), nothing is typed by hand.
set -uo pipefail

BACKUP_DIR="${BACKUP_DIR:-/backups}"
PHOTOS_DIR="${PHOTOS_DIR:-/data/photos}"
DB_HOST="${DB_HOST:-db}"
DB_NAME="${DB_NAME:-gold}"
DB_USER="${DB_USER:-postgres}"
export PGPASSWORD="${POSTGRES_PASSWORD:-}"
STATUS="$BACKUP_DIR/status.json"
mkdir -p "$BACKUP_DIR"
# rclone is configured only through these settings; an empty config file keeps it from looking for one
export RCLONE_CONFIG="${RCLONE_CONFIG:-$BACKUP_DIR/.rclone-empty.conf}"; touch "$RCLONE_CONFIG" 2>/dev/null || true

pg() { psql -h "$DB_HOST" -U "$DB_USER" -v ON_ERROR_STOP=1 -X -q "$@"; }
now() { date -Iseconds; }
log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }

# The state of the backups: a simple key=value file (status.env) and the same as JSON (status.json), for people (`status`) and later
# for a system-status page.
STATE="$BACKUP_DIR/status.env"
json_escape() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }
set_status() { # key value [key value ...]
  touch "$STATE"
  while [ $# -ge 2 ]; do
    grep -v "^$1=" "$STATE" > "$STATE.tmp" || true
    mv "$STATE.tmp" "$STATE"
    printf '%s=%s\n' "$1" "$(printf '%s' "$2" | tr -d '\n\r')" >> "$STATE"
    shift 2
  done
  local first=1
  { printf '{'; while IFS='=' read -r k v; do [ -n "$k" ] || continue; [ "$first" = 1 ] || printf ','; first=0; printf '"%s":"%s"' "$k" "$(json_escape "$v")"; done < "$STATE"; printf '}\n'; } > "$STATUS.tmp" && mv "$STATUS.tmp" "$STATUS"
}

# Tells the company's directors (everyone who may change company settings) in the app's notifications. Never fails the job by itself.
notify_directors() { # title body
  # (psql fills in :'title' safely only in SQL read from input, not in -c)
  printf '%s\n' "select gold.notify(t.id, 'backup_problem', :'title', :'body', '/settings/company', null, 'settings:manage') from gold.tenants t;" \
    | pg -d "$DB_NAME" -v title="$1" -v body="$2" >/dev/null 2>&1 || log "could not send the notification (is the database reachable?)"
}

# The off-site copy, if set up: an S3 bucket (Backblaze B2, AWS S3, Wasabi, ...) behind rclone's encryption, so the provider only ever
# stores scrambled files. Without BACKUP_ENCRYPTION_PASSPHRASE nothing is sent: customer IDs and pictures must not leave unencrypted.
offsite_ready() {
  [ -n "${BACKUP_S3_BUCKET:-}" ] || return 1
  if [ -z "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ]; then return 2; fi
  if [ -z "${RCLONE_CONFIG_OFFSITE_TYPE:-}" ]; then
    export RCLONE_CONFIG_OFFSITE_TYPE=s3
    export RCLONE_CONFIG_OFFSITE_PROVIDER="${BACKUP_S3_PROVIDER:-Other}"
    export RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID="${BACKUP_S3_KEY_ID:-}"
    export RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY="${BACKUP_S3_SECRET:-}"
    export RCLONE_CONFIG_OFFSITE_ENDPOINT="${BACKUP_S3_ENDPOINT:-}"
    export RCLONE_CONFIG_OFFSITE_REGION="${BACKUP_S3_REGION:-}"
    export RCLONE_CONFIG_OFFSITE_NO_CHECK_BUCKET=true   # keys limited to one bucket cannot list or create buckets
  fi
  export RCLONE_CONFIG_SECURE_TYPE=crypt
  export RCLONE_CONFIG_SECURE_REMOTE="offsite:${BACKUP_S3_BUCKET}/gilded"
  RCLONE_CONFIG_SECURE_PASSWORD=$(rclone obscure "$BACKUP_ENCRYPTION_PASSPHRASE"); export RCLONE_CONFIG_SECURE_PASSWORD
  export RCLONE_CONFIG_SECURE_PASSWORD2="$RCLONE_CONFIG_SECURE_PASSWORD"
  return 0
}