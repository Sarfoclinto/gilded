#!/bin/sh
# Runs once, the first time the database volume is created. Creates the two logins and the empty "gold" database.
set -e
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres <<SQL
create role gold_migrator login password '${GOLD_MIGRATOR_PASSWORD}' nosuperuser createdb nocreaterole;
create role gold_app login password '${GOLD_APP_PASSWORD}' nosuperuser nocreatedb nocreaterole;
create database gold owner gold_migrator;
SQL