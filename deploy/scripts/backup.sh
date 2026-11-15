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
# the photos too (they are files, not in the database): one copy per backup, same name with -photos
p="backups/gilded-$(date +%Y%m%d-%H%M%S)-photos.tar.gz"
if docker compose exec -T api sh -c 'test -d /data/photos' >/dev/null 2>&1; then
  docker compose exec -T api tar -czf - -C /data/photos . > "$p" || { echo "Photos backup failed"; rm -f "$p"; exit 1; }
  ls -1t backups/gilded-*-photos.tar.gz 2>/dev/null | tail -n +15 | xargs -r rm -f
  echo "Saved $p ($(du -h "$p" | cut -f1))"
fi
echo "Saved $f ($(du -h "$f" | cut -f1))"