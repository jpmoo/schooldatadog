"""Emit a self-contained .sql file that loads a dataset on the server.

The file uses COPY into TEMP staging tables (keyed by natural keys — BEDS code
and metric code, never server-assigned ids) followed by set-based
INSERT … SELECT … ON CONFLICT DO UPDATE. That makes the load fast, idempotent,
and portable: on the server it's just `psql "$DATABASE_URL" -f the_file.sql`,
with no Python, mdbtools, or Access files needed there.

The COPY blocks use Postgres text format: tab-separated columns, backslash-N for
NULL, and backslash escapes for tab/newline/carriage-return/backslash.
"""

from __future__ import annotations

from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

from .describe import describe
from .entities import infer_entity_type
from .model import FactRecord, MetricSpec


def _esc(value: Optional[str]) -> str:
    """Escape a text field for a COPY … FROM stdin block."""
    if value is None:
        return r"\N"
    s = str(value)
    return (
        s.replace("\\", "\\\\")
        .replace("\t", "\\t")
        .replace("\n", "\\n")
        .replace("\r", "\\r")
    )


def _num(value: Optional[float]) -> str:
    return r"\N" if value is None else repr(value)


# The upsert/finalize block. Enum-typed columns cast from text staging.
_FINALIZE = """
-- Upsert entities (by BEDS code) --------------------------------------------
INSERT INTO entities (beds_code, name, type)
SELECT beds_code, name, type::entity_type
  FROM _stg_entities
ON CONFLICT (beds_code) DO UPDATE
  -- Don't clobber a real name with a code fallback (some datasets have no name).
  SET name = CASE
               WHEN EXCLUDED.name = entities.beds_code THEN entities.name
               ELSE EXCLUDED.name
             END;

-- Upsert metrics (by code) --------------------------------------------------
INSERT INTO metrics (code, name, description, category, data_type, unit, source)
SELECT code, name, description, category, data_type::data_type, unit, source
  FROM _stg_metrics
ON CONFLICT (code) DO UPDATE SET
  name        = EXCLUDED.name,
  description = COALESCE(EXCLUDED.description, metrics.description),
  category    = EXCLUDED.category,
  data_type   = EXCLUDED.data_type,
  unit        = EXCLUDED.unit,
  source      = COALESCE(EXCLUDED.source, metrics.source);

-- Upsert facts, resolving FKs by natural key --------------------------------
INSERT INTO facts (entity_id, metric_id, school_year, subgroup, value_numeric, value_text)
SELECT e.id, m.id, s.school_year, s.subgroup, s.value_numeric, s.value_text
  FROM _stg_facts s
  JOIN entities e ON e.beds_code = s.beds_code
  JOIN metrics  m ON m.code      = s.metric_code
ON CONFLICT (entity_id, metric_id, school_year, subgroup) DO UPDATE SET
  value_numeric = EXCLUDED.value_numeric,
  value_text    = EXCLUDED.value_text;

-- Link schools to their parent district (BEDS rollup) -----------------------
UPDATE entities e
   SET parent_district_id = d.id
  FROM entities d
 WHERE e.type = 'school'
   AND left(e.beds_code, 8) <> '00000000'
   AND d.beds_code = left(e.beds_code, 8) || '0000'
   AND d.id <> e.id
   AND e.parent_district_id IS DISTINCT FROM d.id;
"""


def _dedupe(records: Iterable[FactRecord]):
    entities: Dict[str, Tuple[str, str]] = {}
    metrics: Dict[str, MetricSpec] = {}
    for r in records:
        if r.entity_cd:
            entities.setdefault(
                r.entity_cd,
                (r.entity_name or r.entity_cd, infer_entity_type(r.entity_cd, r.entity_name)),
            )
        metrics.setdefault(r.metric.code, r.metric)
    return entities, metrics


def emit_sql(
    out_path: str | Path,
    records: List[FactRecord],
    dataset: str,
    school_year: str,
) -> dict:
    entities, metrics = _dedupe(records)

    # Collapse duplicate fact keys (last wins). A set-based upsert cannot touch
    # the same (entity, metric, year, subgroup) row twice in one statement, so
    # the emitted file must present each key at most once.
    by_key: Dict[Tuple[str, str, str, str], FactRecord] = {}
    for r in records:
        if not r.entity_cd:
            continue
        by_key[(r.entity_cd, r.metric.code, r.school_year, r.subgroup)] = r
    fact_rows = list(by_key.values())
    out_path = Path(out_path)

    with out_path.open("w", encoding="utf-8") as f:
        f.write(
            f"-- School Data Dog ingestion output\n"
            f"-- dataset={dataset}  school_year={school_year}\n"
            f"-- entities={len(entities)}  metrics={len(metrics)}  facts={len(fact_rows)}\n"
            f"-- Load with:  psql \"$DATABASE_URL\" -f {out_path.name}\n\n"
            "BEGIN;\n\n"
        )

        # Entities
        f.write("CREATE TEMP TABLE _stg_entities (beds_code text, name text, type text) ON COMMIT DROP;\n")
        f.write("COPY _stg_entities (beds_code, name, type) FROM stdin;\n")
        for cd, (name, etype) in entities.items():
            f.write("\t".join((_esc(cd), _esc(name), _esc(etype))) + "\n")
        f.write("\\.\n\n")

        # Metrics
        f.write(
            "CREATE TEMP TABLE _stg_metrics (code text, name text, description text, "
            "category text, data_type text, unit text, source text) ON COMMIT DROP;\n"
        )
        f.write("COPY _stg_metrics (code, name, description, category, data_type, unit, source) FROM stdin;\n")
        for m in metrics.values():
            f.write(
                "\t".join(
                    (
                        _esc(m.code),
                        _esc(m.name),
                        _esc(describe(m)),
                        _esc(m.category),
                        _esc(m.data_type),
                        _esc(m.unit),
                        _esc(m.source),
                    )
                )
                + "\n"
            )
        f.write("\\.\n\n")

        # Facts
        f.write(
            "CREATE TEMP TABLE _stg_facts (beds_code text, metric_code text, school_year text, "
            "subgroup text, value_numeric double precision, value_text text) ON COMMIT DROP;\n"
        )
        f.write(
            "COPY _stg_facts (beds_code, metric_code, school_year, subgroup, value_numeric, value_text) FROM stdin;\n"
        )
        for r in fact_rows:
            f.write(
                "\t".join(
                    (
                        _esc(r.entity_cd),
                        _esc(r.metric.code),
                        _esc(r.school_year),
                        _esc(r.subgroup),
                        _num(r.value_numeric),
                        _esc(r.value_text),
                    )
                )
                + "\n"
            )
        f.write("\\.\n")

        f.write(_FINALIZE)
        f.write("\nCOMMIT;\n")

    return {
        "entities": len(entities),
        "metrics": len(metrics),
        "facts": len(fact_rows),
        "path": str(out_path),
    }
