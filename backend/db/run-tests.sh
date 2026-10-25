#!/usr/bin/env bash
# Builds a throw-away database, applies every migration in order, then runs each file in tests/.
# Usage: ./run-tests.sh [psql connection args]   e.g. ./run-tests.sh -h localhost -U postgres
# The login needs permission to create databases and roles (a local postgres superuser is fine). Nothing outside gold_test is touched.
set -euo pipefail
cd "$(dirname "$0")"
PSQL=(psql -X -v ON_ERROR_STOP=1 -q "$@")
DB=gold_test
"${PSQL[@]}" -d postgres -c "drop database if exists $DB" -c "create database $DB"
"${PSQL[@]}" -d postgres -f setup/00_roles.sql
for f in migrations/*.sql; do echo "migrate $f"; "${PSQL[@]}" -d $DB -f "$f"; done
for f in tests/*.sql; do echo "test    $f"; "${PSQL[@]}" -d $DB -f "$f"; done
echo "ALL DATABASE TESTS PASSED"
