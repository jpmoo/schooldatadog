# 🐕 School Data Dog

A web tool for exploring and comparing New York State school & district data —
comparative graphs, AI-assisted grouping/prompting, and drag-and-drop analysis.

This repository currently contains the **backend foundation**: the database,
the data-dictionary schema, and authentication with a self-bootstrapping admin.

## Stack

- **Next.js 16** (App Router, TypeScript) — one app serving both the admin and
  user experiences
- **PostgreSQL** via **Drizzle ORM** (`postgres.js` driver)
- **Tailwind CSS 4**
- Session auth (bcrypt + httpOnly cookies), no third-party auth service

## Data model

| Table       | Purpose                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------- |
| `metrics`   | **The data dictionary.** One row per datapoint (code, name, description, category, type…).   |
| `entities`  | Schools & districts, keyed by NY **BEDS code**; schools roll up to a `parent_district_id`.   |
| `facts`     | The actual data in **long/tidy** form: `(entity, metric, school_year) → value`.              |
| `users`     | Accounts with a `role` (`admin` / `user`). The **first signup becomes admin**.               |
| `sessions`  | Server-side sessions; the cookie holds an opaque token, the DB stores only its SHA-256 hash. |
| `settings`  | Key/value store for admin-configured settings (e.g. the Ollama server URL and model).        |

The `facts.metric_id → metrics.id` foreign key is the tie between raw data and
its human-readable description. Long format means ingesting a new dataset never
requires a schema change, and the front end can pivot any set of metrics into
spreadsheet columns on demand.

## Getting started

1. **Configure the database connection**

   ```bash
   cp .env.example .env
   # edit .env and set DATABASE_URL to your Postgres instance
   ```

2. **Create the schema** (applies the generated migrations)

   ```bash
   npm run db:migrate
   ```

3. **Run the app**

   ```bash
   npm run dev        # http://localhost:3000
   ```

4. **Create the admin account** — visit `/signup`. The very first account is
   automatically promoted to system administrator and gets access to the
   **Data Management** tools.

## Database scripts

| Script                | What it does                                                        |
| --------------------- | ------------------------------------------------------------------- |
| `npm run db:generate` | Diff the schema and write a new SQL migration into `drizzle/`.       |
| `npm run db:migrate`  | Apply pending migrations to `DATABASE_URL`.                          |
| `npm run db:push`     | Push the schema directly (handy in early dev; skips migration files).|
| `npm run db:studio`   | Open Drizzle Studio to browse the data.                             |

## Deployment workflow

Develop locally → push to GitHub → pull on the home server. Two things get set
up on the server: the **schema** (automated, ships in git) and the **data**
(prebuilt SQL artifacts you copy over).

**First-run bootstrap** (installs deps, builds, migrates the schema, loads any
data present):

```bash
# on the server, with DATABASE_URL set in .env:
./scripts/bootstrap.sh      # == npm run setup
npm run start
```

**Loading data.** The NYSED data is public, so prebuilt SQL artifacts are
committed (gzipped) to `data-loads/` and travel to the server via `git pull`:

```bash
# 1. on your dev machine — emit + compress an artifact per dataset/year:
python -m sdd_ingest.cli enrollment ENROLL2023.mdb --year 2022-23 \
    --emit-sql data-loads/enroll_2022-23.sql
gzip data-loads/enroll_2022-23.sql            # ~10x smaller; loader reads .gz
git add data-loads/enroll_2022-23.sql.gz && git commit && git push

# 2. on the server — pull, then load every artifact (idempotent, re-runnable):
git pull
npm run db:load            # == ./scripts/load-data.sh ./data-loads
```

Each artifact `COPY`s into temp staging tables and upserts by natural key
(BEDS code, metric code), so loads are order-independent and re-runnable. Only
`psql` is needed on the server — no Python or mdbtools.

> **Note:** GitHub rejects single files over 100 MB. Most gzipped artifacts are
> far smaller, but the School Report Card (SRC) is large enough that its artifact
> is emitted in chunks (multiple `.sql.gz` files the loader runs in order).

## AI (Ollama)

AI features run against an **Ollama** server the admin configures in-app (no env
var needed). Go to **Data Management → AI / Ollama**, enter the server's IP/port
(port defaults to `11434`), click **Connect**, then pick two models from the
refreshable dropdowns:

- **Inference model** — the main model for chat, grouping, and prompting.
- **Embedding model** — generates embeddings for semantic search (e.g.
  `nomic-embed-text`, `mxbai-embed-large`).

The URL and both model selections are stored in the `settings` table. All Ollama
calls are made server-side (`src/lib/ollama/`), so the server address is never
exposed to the browser.

### Metric embeddings (semantic search over datapoints)

Once an embedding model is configured and data is loaded, generate embeddings for
the metric catalog so users can search datapoints by meaning:

```bash
npm run embed:metrics             # uses the admin-configured Ollama + embedding model
npm run embed:metrics -- --dry-run   # show what needs (re)embedding
```

Embeddings are stored on `metrics` (`embedding` jsonb, plus `embedding_model` /
`embedding_hash`). The script is **incremental** — it only (re)embeds metrics
that are new or whose text or model changed — so it's cheap to re-run after each
ingest. No pgvector needed: the catalog is small enough for brute-force cosine
ranking. Re-run it after loading new data or after parsing dictionaries that add
descriptions.

## Roadmap (next up)

- Admin: data-dictionary CRUD + CSV/Excel ingestion mapped to metrics
- User: comparative graphs and the drag-and-drop spreadsheet view
- Wire the selected Ollama model into AI-assisted grouping and prompting
