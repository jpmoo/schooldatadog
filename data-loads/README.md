# data-loads

Drop prebuilt ingestion SQL artifacts (`*.sql` or `*.sql.gz`) here. On the
server, `./scripts/load-data.sh` (and `bootstrap.sh`) load every file in this
folder into the database via `psql`.

The `.sql` files are **not** committed to git (they're large and regenerable) —
only this README and the `.gitignore` are tracked. Get artifacts here by:

```bash
# generate on your dev machine (see ingest/README.md), e.g.:
python -m sdd_ingest.cli enrollment ENROLL2023.mdb --year 2022-23 \
    --emit-sql ../data-loads/enroll_2022-23.sql
gzip ../data-loads/enroll_2022-23.sql        # optional but recommended

# copy them to the server:
rsync -avz data-loads/ user@server:/path/to/app/data-loads/
```

Then on the server: `./scripts/load-data.sh`
