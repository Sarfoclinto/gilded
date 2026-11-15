#!/usr/bin/env bash
# Puts a backup back. REPLACES everything now in the database.   ./scripts/restore.sh backups/gilded-XXXX.sql.gz [backups/gilded-XXXX-photos.tar.gz]
# The second file (optional) puts the photos back too.
set -euo pipefail
cd "$(dirname "$0")/.."
f="${1:?Usage: ./scripts/restore.sh backups/<file>.sql.gz}"
read -r -p "This erases the current data and loads $f. Type YES to continue: " ok
[ "$ok" = "YES" ] || { echo "Cancelled."; exit 1; }
docker compose stop api web
docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "drop database if exists gold" -c "create database gold owner gold_migrator"
# "set role" makes the restored tables belong to gold_migrator, as after a normal install (otherwise later updates cannot change them)
gunzip -c "$f" | docker compose exec -T db psql -U postgres -d gold -v ON_ERROR_STOP=1 -q -c "set role gold_migrator" -f -
docker compose up -d
if [ -n "${2:-}" ]; then
  sleep 5
  docker compose exec -T api sh -c 'mkdir -p /data/photos && tar -xzf - -C /data/photos' < "$2"
  echo "Photos restored from $2."
fi
echo "Restored."