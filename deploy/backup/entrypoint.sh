#!/usr/bin/env bash
# Starts the schedule. busybox crond does not hand the container's settings to its jobs, so they are written to a file the jobs read.
set -euo pipefail
if [ "${1:-cron}" != cron ]; then exec "$@"; fi
export -p | grep -E ' (POSTGRES_PASSWORD|DB_|BACKUP_|RCLONE_|TZ|PHOTOS_DIR)' > /etc/backup.env || true
chmod 600 /etc/backup.env
mkdir -p /etc/crontabs
{
  echo "${BACKUP_SCHEDULE:-30 1 * * *} . /etc/backup.env; /usr/local/bin/backup-now >> /backups/backup.log 2>&1"
  echo "${RESTORE_CHECK_SCHEDULE:-15 3 * * 0} . /etc/backup.env; /usr/local/bin/restore-check >> /backups/backup.log 2>&1"
} > /etc/crontabs/root
echo "Backups scheduled: '${BACKUP_SCHEDULE:-30 1 * * *}' (restore check '${RESTORE_CHECK_SCHEDULE:-15 3 * * 0}'), time zone ${TZ:-UTC}."
exec crond -f -l 8