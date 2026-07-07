# Deploying School Data Dog to the server

Serves the app under `https://<host>/schooldatadog` (reverse-proxied by Caddy) on
port **8935**, backed by the server's local PostgreSQL, running as a systemd
service that survives reboot.

Replace every `⟨…⟩` placeholder below (especially `⟨PGPASSWORD⟩`).

---

## 0. Prerequisites

- **Node.js 20+** and npm (`node -v`)
- **PostgreSQL 14+** installed locally with `psql` on PATH
- **git**, and GitHub auth for this private repo (`gh auth login`, or an SSH deploy key)
- Caddy already fronting the host (you have this)

> The server does **not** need Python or mdbtools — the data ships as prebuilt
> SQL and loads with `psql` only.

---

## 1. Clone the repo (data is included)

The 27 gzipped data payloads are committed in the repo, so one clone brings the
code *and* the data (~350 MB).

```bash
cd ⟨path-to⟩/schooldatadog          # the directory you already created (must be empty)
git clone https://github.com/jpmoo/schooldatadog.git .
# SSH alternative: git clone git@github.com:jpmoo/schooldatadog.git .
```

---

## 2. PostgreSQL: create the role and database

**Confirm Postgres is running:**

```bash
pg_isready                          # expect "accepting connections"
# not installed? (Debian/Ubuntu):  sudo apt install postgresql
# not running?                     sudo systemctl enable --now postgresql
```

**Create a dedicated role and an empty database it owns:**

```bash
sudo -u postgres psql <<'SQL'
CREATE ROLE schooldatadog LOGIN PASSWORD '⟨PGPASSWORD⟩';
CREATE DATABASE schooldatadog OWNER schooldatadog;
SQL
```

Owning the database gives the role full rights on its `public` schema (PostgreSQL
15+), so the migrations in step 4 can create the tables. The database starts
empty — **the tables are created by the migrations**, not here.

**Verify the exact connection string the app will use works:**

```bash
psql "postgres://schooldatadog:⟨PGPASSWORD⟩@localhost:5432/schooldatadog" -c '\conninfo'
```

If that fails with a password/authentication error, your `pg_hba.conf` isn't
allowing password auth over localhost. Add (or confirm) these lines, then reload:

```conf
# /etc/postgresql/*/main/pg_hba.conf
host    all    all    127.0.0.1/32    scram-sha-256
host    all    all    ::1/128         scram-sha-256
```

```bash
sudo systemctl reload postgresql
```

---

## 3. Configure `.env`

```bash
cat > .env <<EOF
# App database (same string you just verified)
DATABASE_URL="postgres://schooldatadog:⟨PGPASSWORD⟩@localhost:5432/schooldatadog"

# Sub-path Caddy serves the app under. Baked in at build time.
BASE_PATH="/schooldatadog"
EOF
```

> `PORT` is **not** set here — `next start` reads it from the process
> environment, so it goes in the systemd unit (step 5).

---

## 4. Build, migrate, and load the data

One command: installs deps → builds (bakes in `BASE_PATH`) → runs migrations
(creates the tables) → loads all 27 payloads.

```bash
./scripts/bootstrap.sh
```

⏳ **~20–30 minutes** — the School Report Card and Digital Resources payloads are
~10 M rows each. It's just `psql` loading; let it finish. Loads are idempotent,
so it's safe to re-run if interrupted.

Sanity check (temporary foreground start; expect HTTP **200**):

```bash
PORT=8935 npm run start &
sleep 3; curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8935/schooldatadog/login
kill %1
```

---

## 5. Run as a reboot-surviving service (port 8935)

Run this **from inside the app directory** — it fills in the paths for you:

```bash
APP_DIR="$(pwd)"
NODE_DIR="$(dirname "$(command -v node)")"
sudo tee /etc/systemd/system/schooldatadog.service >/dev/null <<EOF
[Unit]
Description=School Data Dog
After=network.target postgresql.service

[Service]
Type=simple
User=$USER
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=PORT=8935
Environment=PATH=$NODE_DIR:/usr/local/bin:/usr/bin:/bin
ExecStart=$NODE_DIR/npm run start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now schooldatadog       # start now + on every boot
sudo systemctl status schooldatadog --no-pager | head -6
```

---

## 6. Caddy (no `strip_prefix` — Next owns the prefix via basePath)

```caddy
handle /schooldatadog* {
    reverse_proxy 127.0.0.1:8935
}
```

```bash
sudo systemctl reload caddy
```

Visit **`https://⟨tailscale-host⟩/schooldatadog`**.

---

## 7. First run

1. Sign up — **the first account becomes admin**.
2. **Data Management → AI / Ollama**: enter your Ollama IP/port, Connect, pick an
   inference model and an embedding model.
3. Generate semantic-search embeddings (after Ollama is configured):
   ```bash
   npm run embed:metrics
   ```

---

## Updating later

`restart.sh` (in the repo root) stops the service, frees port 8935, pulls,
rebuilds, migrates, and restarts:

```bash
./restart.sh
```

- Uses `sudo` only for the two `systemctl` calls; git/npm run as you.
- Does **not** reload data. When new payloads are published, run `npm run db:load`.

---

## Troubleshooting

```bash
journalctl -u schooldatadog -f            # live app logs
sudo systemctl restart schooldatadog      # restart without a code change
```

- **502 from Caddy** → the app isn't up on 8935: `systemctl status schooldatadog`.
- **Assets 404 / unstyled page** → the build didn't get `BASE_PATH`. Confirm it's
  in `.env`, then rebuild (`./restart.sh`).
- **DB connection errors** → re-run the `psql "…" -c '\conninfo'` check from step 2.
- **`node`/`npm` not found by systemd** → the `NODE_DIR` in the unit is wrong;
  re-run step 5 (it derives the path from `command -v node`).
