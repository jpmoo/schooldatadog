# School Data Dog — ingestion toolkit

Standalone Python scripts that read the yearly NYSED datasets out of Microsoft
Access files, melt the wide tables into long
`(entity, metric, school_year, subgroup, value)` facts, and upsert them into the
same Postgres database the web app uses. Kept separate from the Next.js app so
ingestion can run wherever the data lives (your machine or the home server).

## Requirements

- **mdbtools** ≥ 1.0 (reads `.mdb` and `.accdb`)
  - macOS: `brew install mdbtools`
  - Debian/Ubuntu: `apt-get install mdbtools`
- Python 3.10+

## Setup

```bash
cd ingest
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

`DATABASE_URL` is read from the project-root `.env` (shared with the app) or the
environment. It's only needed for real loads — `--dry-run` needs no database.

## Usage

```bash
# 1. Extract an Access file from its zip (mdbtools reads .mdb or .accdb):
unzip -j ../sampledata/2022-2023/ell_2023.zip -d _work

# 2. Preview what would be loaded — no database required:
python -m sdd_ingest.cli ell _work/ELL_2022_2023.accdb --year 2022-23 --dry-run
```

**Metric descriptions.** Pass `--dict FILE` to pull real descriptions from a
dataset's data dictionary (the readme PDF / variable xlsx shipped in each zip);
they get baked into the metrics in the SQL artifact, so the server needs nothing
extra. Descriptions power the semantic search (`npm run embed:metrics`), which
re-embeds only the metrics whose text changed.

```bash
python -m sdd_ingest.cli gradrate GRAD_RATE_2023.mdb --year 2022-23 \
    --dict 2023GradRatemdbReadMe.pdf --dry-run     # shows "N described"
```

Then pick how to load it:

**A. Emit a portable SQL file (recommended for the server).** Ingestion happens
here; the output is one self-contained `.sql` file you copy to the server and
run with nothing but `psql`:

```bash
python -m sdd_ingest.cli ell _work/ELL_2022_2023.accdb --year 2022-23 \
    --emit-sql load_ell_2022-23.sql

# ...then, on the server (no Python / mdbtools / Access files needed there):
psql "$DATABASE_URL" -f load_ell_2022-23.sql
# or gzip it first:  gzip load_ell_2022-23.sql  ->  zcat load_ell_2022-23.sql.gz | psql "$DATABASE_URL"
```

The file loads via `COPY` into temp staging tables keyed by natural keys (BEDS
code, metric code), then upserts and resolves foreign keys server-side — fast
and portable regardless of the ids already in the database.

**B. Write directly to a reachable database** (`DATABASE_URL` from `.env`):

```bash
python -m sdd_ingest.cli ell _work/ELL_2022_2023.accdb --year 2022-23
```

Both paths are **idempotent** — re-running upserts on `metrics.code`,
`entities.beds_code`, and `facts (entity, metric, school_year, subgroup)`.

## How it models the data

- **Wide → long.** Every value column becomes a metric; each cell becomes a fact.
- **Subgroups as a dimension.** Demographic breakdowns that ship as columns
  (`NUM_BLACK`, `PER_MALE`…) collapse onto a base metric with `facts.subgroup`
  set per column, rather than exploding the metric catalog. Grade / subject /
  level fold into the metric code.
- **Suppressed values** (`s`, `-`, `*`, `N/A`) are kept as `value_text` with a
  null number, so the UI can distinguish "suppressed" from "missing".
- **Entities** are upserted by BEDS code; schools are linked to their parent
  district by the BEDS rollup rule.

## Datasets

| Key          | Source dataset             | Status                         |
| ------------ | -------------------------- | ------------------------------ |
| `enrollment`      | BEDS Day Enrollment        | ✅ loaded & verified           |
| `ell`             | English Language Learners  | ✅ loaded & verified           |
| `gradrate`        | Graduation Rate & Outcomes | ✅ loaded & verified           |
| `studed`          | Student & Educator         | ✅ loaded & verified           |
| `pathways`        | Graduation/Career Pathways | ✅ loaded & verified           |
| `refusals`        | 3-8 ELA/Math refusals      | ✅ loaded & verified           |
| `apib_course`     | AP / IB participation      | ✅ loaded & verified           |
| `apib_assessment` | AP / IB assessment outcomes| ✅ loaded & verified           |
| `sdr`             | Student Digital Resources  | ✅ module built (9.5M facts)   |
| `src`             | School Report Card         | ✅ loaded & verified (9.7M)    |

All datasets built. The DB holds ~14.9M facts / 445 metrics across 13 categories
(from the 2022-23 release; other years re-run the same commands on their folders).

The canonical metric catalog is built from the 2022-23 and 2023-24 files (which
contain every dataset); 2024-25 is missing AP/IB and ELL.
