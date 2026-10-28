#!/usr/bin/env bash
# Makes a compressed copy of the whole database in ./backups. Run from the deploy folder:  ./scripts/backup.sh
# Keeps the newest 14 copies. Copy the files somewhere else too (another computer or cloud storage): a backup on the same machine is not enough.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p backups
f="backups/gilded-$(date +%Y%m%d-%H%M%S).sql.gz"
docker compose exec -T db pg_dump -U postgres -d gold --no-owner | gzip > "$f"
test -s "$f" || { echo "Backup is empty - something is wrong"; rm -f "$f"; exit 1; }
ls -1t backups/gilded-*.sql.gz | tail -n +15 | xargs -r rm -f
echo "Saved $f ($(du -h "$f" | cut -f1))"