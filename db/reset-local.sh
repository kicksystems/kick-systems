#!/usr/bin/env bash
# Rebuilds the LOCAL database from scratch: Supabase shim, migrations, demo data.
set -euo pipefail
PSQL="psql -v ON_ERROR_STOP=1 -q -h 127.0.0.1 -p ${PGPORT:-54322} -U postgres"
$PSQL -d postgres -c "drop database if exists kick" -c "create database kick"
$PSQL -d kick -f db/local/00_supabase_shim.sql
for f in supabase/migrations/*.sql; do
  # 0003_fada belongs to the Fada robot project; locally a snapshot of it stands in, right before 0004.
  case "$f" in *0004_*) $PSQL -d kick -f db/local/05_fada_snapshot.sql;; esac
  $PSQL -d kick -f "$f"
done
$PSQL -d kick -f db/local/10_seed_demo.sql
echo "Local database ready."
