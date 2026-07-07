#!/usr/bin/env bash
#
# Load prebuilt ingestion SQL artifacts into the database in $DATABASE_URL.
#
# Runs every *.sql / *.sql.gz file in a directory (default ./data-loads) through
# psql, in sorted filename order, stopping on the first error. Every artifact is
# self-contained and idempotent (upserts by natural key), so re-running is safe
# and load order between files does not affect the result.
#
# Usage:
#   DATABASE_URL=postgres://…  ./scripts/load-data.sh [DIR]
#
set -euo pipefail

# Load .env (if present) so DATABASE_URL is available without exporting it.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[ -f "$ROOT/.env" ] && { set -a; . "$ROOT/.env"; set +a; }

DIR="${1:-$ROOT/data-loads}"
: "${DATABASE_URL:?DATABASE_URL must be set (put it in .env or export it)}"

command -v psql >/dev/null 2>&1 || { echo "error: psql not found on PATH"; exit 1; }
[ -d "$DIR" ] || { echo "error: directory not found: $DIR"; exit 1; }

shopt -s nullglob
files=("$DIR"/*.sql "$DIR"/*.sql.gz)
shopt -u nullglob

if [ ${#files[@]} -eq 0 ]; then
  echo "No .sql or .sql.gz files found in $DIR — nothing to load."
  exit 1
fi

# Deterministic order.
IFS=$'\n' files=($(sort <<<"${files[*]}")); unset IFS

echo "Loading ${#files[@]} artifact(s) from $DIR into the database…"
for f in "${files[@]}"; do
  echo "==> $(basename "$f")"
  if [[ "$f" == *.gz ]]; then
    gunzip -c "$f" | psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q
  else
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f"
  fi
done

# Post-load reconciliation (idempotent): populate county and drop aggregate rows,
# so fresh installs and re-loads match the migrations regardless of ordering.
psql "$DATABASE_URL" -q -f "$ROOT/scripts/reconcile.sql"

echo "All ${#files[@]} artifact(s) loaded successfully."
