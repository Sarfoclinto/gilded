#!/usr/bin/env bash
# Installs a new version: back up first, fetch the code, rebuild, apply database changes, restart.   ./scripts/update.sh
set -euo pipefail
cd "$(dirname "$0")/.."
./scripts/backup.sh
git -C .. pull --ff-only
docker compose up -d --build
docker compose ps