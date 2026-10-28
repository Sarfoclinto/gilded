#!/usr/bin/env bash
# Puts a backup back. REPLACES everything now in the database.   ./scripts/restore.sh backups/gilded-XXXX.sql.gz
set -euo pipefail
cd "$(dirname "$0")/.."
f="${1:?Usage: ./scripts/restore.sh backups/<file>.sql.gz}"
read -r -p "This erases the current data and loads $f. Type YES to continue: " ok
[ "$ok" = "YES" ] || { echo "Cancelled."; exit 1; }
docker compose stop api web
docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "drop database if exists gold" -c "create database gold owner gold_migrator"
gunzip -c "$f" | docker compose exec -T db psql -U postgres -d gold -v ON_ERROR_STOP=1 -q
docker compose up -d
echo "Restored."