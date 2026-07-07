"""Postgres upserts for entities, metrics, and facts.

psycopg is imported lazily so `--dry-run` works without a database driver
installed. Upsert keys match the unique indexes in the Drizzle schema:
  entities.beds_code
  metrics.code
  facts (entity_id, metric_id, school_year, subgroup)
"""

from __future__ import annotations

from typing import Dict, Iterable, List

from .config import DATABASE_URL
from .describe import describe
from .entities import infer_entity_type
from .model import FactRecord


def connect():
    if not DATABASE_URL:
        raise RuntimeError(
            "DATABASE_URL is not set. Add it to the project .env or the environment."
        )
    import psycopg  # lazy

    return psycopg.connect(DATABASE_URL)


def upsert_entities(cur, records: Iterable[FactRecord]) -> Dict[str, int]:
    names: Dict[str, str] = {}
    for r in records:
        if r.entity_cd:
            names.setdefault(r.entity_cd, r.entity_name)

    id_map: Dict[str, int] = {}
    for cd, name in names.items():
        cur.execute(
            """
            INSERT INTO entities (beds_code, name, type)
            VALUES (%s, %s, %s)
            ON CONFLICT (beds_code) DO UPDATE
              SET name = CASE
                           WHEN EXCLUDED.name = entities.beds_code THEN entities.name
                           ELSE EXCLUDED.name
                         END
            RETURNING id
            """,
            (cd, name or cd, infer_entity_type(cd, name)),
        )
        id_map[cd] = cur.fetchone()[0]
    return id_map


def link_parent_districts(cur) -> int:
    """Set schools' parent_district_id from the BEDS rollup rule, in SQL."""
    cur.execute(
        """
        UPDATE entities e
           SET parent_district_id = d.id
          FROM entities d
         WHERE e.type = 'school'
           AND left(e.beds_code, 8) <> '00000000'
           AND d.beds_code = left(e.beds_code, 8) || '0000'
           AND d.id <> e.id
           AND (e.parent_district_id IS DISTINCT FROM d.id)
        """
    )
    return cur.rowcount


def upsert_metrics(cur, records: Iterable[FactRecord]) -> Dict[str, int]:
    specs = {r.metric.code: r.metric for r in records}
    id_map: Dict[str, int] = {}
    for code, m in specs.items():
        cur.execute(
            """
            INSERT INTO metrics (code, name, description, category, data_type, unit, source)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (code) DO UPDATE SET
              name        = EXCLUDED.name,
              description  = COALESCE(EXCLUDED.description, metrics.description),
              category     = EXCLUDED.category,
              data_type    = EXCLUDED.data_type,
              unit         = EXCLUDED.unit,
              source       = COALESCE(EXCLUDED.source, metrics.source)
            RETURNING id
            """,
            (m.code, m.name, describe(m), m.category, m.data_type, m.unit, m.source),
        )
        id_map[code] = cur.fetchone()[0]
    return id_map


def upsert_facts(
    cur,
    records: List[FactRecord],
    entity_ids: Dict[str, int],
    metric_ids: Dict[str, int],
    batch: int = 5000,
) -> int:
    rows = []
    for r in records:
        eid = entity_ids.get(r.entity_cd)
        mid = metric_ids.get(r.metric.code)
        if eid is None or mid is None:
            continue
        rows.append((eid, mid, r.school_year, r.subgroup, r.value_numeric, r.value_text))

    query = """
        INSERT INTO facts (entity_id, metric_id, school_year, subgroup, value_numeric, value_text)
        VALUES (%s, %s, %s, %s, %s, %s)
        ON CONFLICT (entity_id, metric_id, school_year, subgroup) DO UPDATE SET
          value_numeric = EXCLUDED.value_numeric,
          value_text    = EXCLUDED.value_text
    """
    for i in range(0, len(rows), batch):
        cur.executemany(query, rows[i : i + batch])
    return len(rows)
