#!/usr/bin/env bash
#
# Update + restart School Data Dog on the server:
#   stop the service (and free our port) -> git pull -> install/build/migrate -> start.
#
# Run from anywhere:  ./restart.sh
# Uses sudo only for the systemctl calls (git/npm run as your user, so file
# ownership stays correct). Data is NOT reloaded here — see the note at the end.
#
set -euo pipefail
cd "$(dirname "$0")"

SERVICE=schooldatadog
PORT=8935

echo "==> Stopping $SERVICE"
sudo systemctl stop "$SERVICE" 2>/dev/null || true
# Safety net: kill anything still holding OUR port (scoped, won't touch sibling apps).
if command -v lsof >/dev/null 2>&1; then
  lsof -ti tcp:"$PORT" 2>/dev/null | xargs -r kill 2>/dev/null || true
fi

echo "==> git pull"
git pull --ff-only

echo "==> Installing dependencies"
npm ci

echo "==> Building"
npm run build

echo "==> Applying database migrations (idempotent)"
npm run db:migrate

echo "==> Starting $SERVICE"
sudo systemctl start "$SERVICE"
sleep 1
sudo systemctl --no-pager --lines=0 status "$SERVICE" || true

echo
echo "==> Done. Follow logs with:  journalctl -u $SERVICE -f"
echo "    (New data payloads? load them separately with:  npm run db:load)"
