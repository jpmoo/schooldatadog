#!/usr/bin/env bash
#
# First-run server setup for School Data Dog.
#
#   1. install dependencies      (npm ci)
#   2. build the app             (npm run build)
#   3. apply schema migrations   (npm run db:migrate)  -> creates the tables
#   4. load data if present      (./scripts/load-data.sh ./data-loads)
#
# Prerequisites on the server: Node, npm, a reachable Postgres, and psql on PATH.
# $DATABASE_URL must be set (e.g. in the project .env).
#
# Usage:  ./scripts/bootstrap.sh
#
set -euo pipefail
cd "$(dirname "$0")/.."

# Load .env so DATABASE_URL (etc.) is available to this script, drizzle, and psql.
[ -f .env ] && { set -a; . ./.env; set +a; }

: "${DATABASE_URL:?DATABASE_URL must be set (put it in .env or export it)}"

echo "==> [1/4] Installing dependencies (npm ci)…"
npm ci

echo "==> [2/4] Building the app (npm run build)…"
npm run build

echo "==> [3/4] Applying database migrations…"
npm run db:migrate

echo "==> [4/4] Loading data…"
if compgen -G "./data-loads/*.sql*" >/dev/null 2>&1; then
  ./scripts/load-data.sh ./data-loads
else
  echo "    No SQL artifacts in ./data-loads — skipping."
  echo "    Copy your generated .sql(.gz) files there, then run:"
  echo "      ./scripts/load-data.sh"
fi

echo
echo "==> Bootstrap complete. Start the app with:  npm run start"
