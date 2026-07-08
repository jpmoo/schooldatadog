"""Command-line ingestion runner.

Examples:
    # Preview what would be loaded (no database needed):
    python -m sdd_ingest.cli enrollment path/to/ENROLL2023.mdb --year 2022-23 --dry-run

    # Load into the database in DATABASE_URL:
    python -m sdd_ingest.cli ell path/to/ELL_2022_2023.accdb --year 2022-23
"""

from __future__ import annotations

import argparse
import sys
from collections import Counter
from importlib import import_module
from typing import List

from .entities import infer_entity_type
from .model import FactRecord

# dataset key -> module name under sdd_ingest.datasets
DATASETS = {
    "enrollment": "enrollment",
    "demographics": "demographics",
    "ell": "ell",
    "gradrate": "gradrate",
    "pathways": "pathways",
    "studed": "studed",
    "sdr": "sdr",
    "refusals": "refusals",
    "apib_course": "apib_course",
    "apib_assessment": "apib_assessment",
    "src": "src",
}


def _load(dataset: str):
    return import_module(f"sdd_ingest.datasets.{DATASETS[dataset]}")


def _summarize(dataset: str, records: List[FactRecord]) -> None:
    metrics = {r.metric.code for r in records}
    described = {r.metric.code for r in records if r.metric.description}
    subgroups = Counter(r.subgroup for r in records)
    entities = {r.entity_cd for r in records}
    suppressed = sum(1 for r in records if r.value_numeric is None and r.value_text)
    print(
        f"[{dataset}] {len(records):,} facts | {len(metrics)} metrics "
        f"({len(described)} described) | {len(entities):,} entities | "
        f"{len(subgroups)} subgroups | {suppressed:,} suppressed"
    )


def _preview(records: List[FactRecord], sample: int) -> None:
    print("\nSample facts:")
    for r in records[:sample]:
        val = r.value_numeric if r.value_numeric is not None else f"text:{r.value_text!r}"
        print(f"  {r.entity_cd}  {r.metric.code:34}  [{r.subgroup}]  = {val}")

    metrics = sorted({r.metric.code for r in records})
    print(f"\nMetrics ({len(metrics)}):")
    for code in metrics:
        print(f"  {code}")

    subgroups = sorted({r.subgroup for r in records})
    print(f"\nSubgroups ({len(subgroups)}): {', '.join(subgroups)}")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="sdd_ingest")
    parser.add_argument("dataset", choices=sorted(DATASETS))
    parser.add_argument("path", help="Path to the Access (.mdb/.accdb) file")
    parser.add_argument("--year", required=True, help="School year label, e.g. 2022-23")
    parser.add_argument("--dict", dest="dict_path", metavar="FILE",
                        help="Data-dictionary file (PDF/xlsx) to pull metric descriptions from")
    parser.add_argument("--dry-run", action="store_true",
                        help="Parse and summarize without writing to the database")
    parser.add_argument("--emit-sql", metavar="FILE",
                        help="Write a portable .sql load file (run on the server with psql) "
                             "instead of connecting to a database")
    parser.add_argument("--sample", type=int, default=12, help="Rows to show in --dry-run")
    args = parser.parse_args(argv)

    module = _load(args.dataset)
    print(f"Reading {args.dataset} from {args.path} ({args.year})…")
    records = module.build(args.path, args.year, dict_path=args.dict_path)

    # Drop statewide / NRC aggregate rows ("state" entities) — we only keep real
    # schools & districts.
    before = len(records)
    records = [
        r for r in records if infer_entity_type(r.entity_cd, r.entity_name) != "state"
    ]
    if before != len(records):
        print(f"Skipped {before - len(records):,} statewide/aggregate facts.")

    _summarize(args.dataset, records)

    if args.dry_run:
        _preview(records, args.sample)
        return 0

    if args.emit_sql:
        from .sqlemit import emit_sql

        result = emit_sql(args.emit_sql, records, args.dataset, args.year)
        size_mb = __import__("os").path.getsize(result["path"]) / 1024 / 1024
        print(
            f"Wrote {result['path']} ({size_mb:.1f} MB): "
            f"{result['facts']:,} facts, {result['entities']:,} entities, {result['metrics']} metrics.\n"
            f"Load on the server with:  psql \"$DATABASE_URL\" -f {result['path']}"
        )
        return 0

    from . import db

    with db.connect() as conn:
        with conn.cursor() as cur:
            entity_ids = db.upsert_entities(cur, records)
            metric_ids = db.upsert_metrics(cur, records)
            n_facts = db.upsert_facts(cur, records, entity_ids, metric_ids)
            n_linked = db.link_parent_districts(cur)
        conn.commit()
    print(f"Wrote {n_facts:,} facts across {len(entity_ids):,} entities "
          f"and {len(metric_ids)} metrics; linked {n_linked:,} schools to districts.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
