#!/usr/bin/env bash
# Creates the company, its first branch and the first director. Run ONCE after the first "docker compose up".
# Usage: ./scripts/first-company.sh "Company Name" director-username BRANCHCODE "Branch Name" ["Director Display Name"]
set -euo pipefail
cd "$(dirname "$0")/.."
[ $# -ge 4 ] || { echo 'Usage: ./scripts/first-company.sh "Company Name" director-username BRANCHCODE "Branch Name" ["Display Name"]'; exit 1; }
set -a; . ./.env; set +a
read -r -s -p "Choose the director's password (10+ characters): " pw; echo
docker compose run --rm -e GOLD_SEED_PASSWORD="$pw" api seed \
  --company "$COMPANY_SLUG" --company-name "$1" --admin "$2" --branch-code "$3" --branch-name "$4" --display-name "${5:-$2}"