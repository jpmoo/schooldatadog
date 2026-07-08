"""Melting wide Access tables into long FactRecords.

Each dataset supplies a spec mapping value-column -> (MetricSpec, subgroup). A
subgroup of None means the column isn't a demographic breakdown, so it defaults
to "All Students". This one helper covers both shapes we see in the data:

  * plain wide tables (enrollment by grade)  -> subgroup None on every column
  * subgroup-in-columns (ELL NUM_BLACK…)      -> subgroup set per column, so the
    breakdown lands in facts.subgroup instead of exploding the metric catalog.
"""

from __future__ import annotations

from dataclasses import replace
from typing import Callable, Dict, List, Optional, Tuple

import pandas as pd

from .model import FactRecord, MetricSpec
from .subgroups import ALL_STUDENTS, canon_subgroup
from .values import parse_value

# column name -> (metric, subgroup-or-None)
ColumnSpecs = Dict[str, Tuple[MetricSpec, Optional[str]]]


def melt_specs(
    df: pd.DataFrame,
    entity_cd_col: str,
    entity_name_col: str,
    school_year: str,
    specs: ColumnSpecs,
    year_col: Optional[str] = None,
    year_transform: Optional[Callable[[str], Optional[str]]] = None,
    folder_year_only: bool = False,
) -> List[FactRecord]:
    """Melt a wide table into FactRecords.

    If `year_col` is given, each row's school year is derived from that column
    (via `year_transform`), rather than the fixed `school_year` — NYSED history
    files carry several years of data in one table. A row whose year can't be
    parsed is skipped.
    """
    present = {c: s for c, s in specs.items() if c in df.columns}
    missing = [c for c in specs if c not in df.columns]
    if missing:
        # Non-fatal: NYSED renames/drops columns between years. Surface it.
        print(f"  note: {len(missing)} spec'd columns absent this year: {missing[:8]}"
              + ("…" if len(missing) > 8 else ""))

    records: List[FactRecord] = []
    cd_series = df[entity_cd_col] if entity_cd_col in df.columns else None
    name_series = df[entity_name_col] if entity_name_col in df.columns else None
    year_series = df[year_col] if (year_col and year_col in df.columns) else None

    for idx in range(len(df)):
        ecd = (cd_series.iat[idx].strip() if cd_series is not None else "")
        ename = (name_series.iat[idx].strip() if name_series is not None else "")
        if not ecd and not ename:
            continue

        if year_series is not None:
            raw_year = year_series.iat[idx]
            sy = year_transform(raw_year) if year_transform else str(raw_year).strip()
            if not sy:
                continue  # unparseable year -> skip row
            if school_year:
                # folder_year_only: keep only this folder's own year (drops both
                # older and future snapshots the history file carries). Otherwise
                # just drop years newer than the folder ("YYYY-YY" sorts lexically).
                if folder_year_only:
                    if sy != school_year:
                        continue
                elif sy > school_year:
                    continue
        else:
            sy = school_year

        for col, (metric, subgroup) in present.items():
            num, text, skip = parse_value(df[col].iat[idx])
            if skip:
                continue
            records.append(
                FactRecord(
                    entity_cd=ecd,
                    entity_name=ename,
                    metric=metric,
                    school_year=sy,
                    subgroup=subgroup or ALL_STUDENTS,
                    value_numeric=num,
                    value_text=text,
                )
            )
    return records


def melt_rows(
    df: pd.DataFrame,
    entity_cd_col: str,
    entity_name_col: str,
    value_specs: Dict[str, MetricSpec],
    school_year: Optional[str] = None,
    school_year_col: Optional[str] = None,
    year_transform: Optional[Callable[[str], Optional[str]]] = None,
    subgroup_col: Optional[str] = None,
    dimension_col: Optional[str] = None,
    dimension_fn: Optional[Callable[[str], Optional[Tuple[str, str]]]] = None,
    dimensions: Optional[List[Tuple[str, Callable[[str], Optional[Tuple[str, str]]]]]] = None,
    folder_year_only: bool = False,
) -> List[FactRecord]:
    """Melt a *row-based* table (NYSED's other common shape).

    Here each row already carries its subgroup as a value (`subgroup_col`), and
    often one or more extra dimensions in other columns (a cohort, subject,
    pathway…) that fold into the metric code. Each dimension is a
    (column, fn) pair where fn(value) -> (code_suffix, name_suffix) or None to
    skip the row. Pass a single one via `dimension_col`/`dimension_fn`, or
    several via `dimensions`. The measure columns in `value_specs` are melted
    into facts. Used by graduation rate, pathways, and the School Report Card.
    """
    present = {c: m for c, m in value_specs.items() if c in df.columns}
    cd = df[entity_cd_col]
    name = df[entity_name_col] if (entity_name_col and entity_name_col in df.columns) else None
    sy_series = df[school_year_col] if (school_year_col and school_year_col in df.columns) else None
    sub_series = df[subgroup_col] if (subgroup_col and subgroup_col in df.columns) else None
    value_series = {c: df[c] for c in present}

    dim_pairs = list(dimensions) if dimensions else []
    if dimension_col and dimension_fn:
        dim_pairs.append((dimension_col, dimension_fn))
    dim_series = [
        (df[c] if c in df.columns else None, fn) for c, fn in dim_pairs
    ]

    spec_cache: Dict[Tuple[str, str], MetricSpec] = {}
    records: List[FactRecord] = []

    for i in range(len(df)):
        ecd = (cd.iat[i] or "").strip()
        ename = (name.iat[i] or "").strip() if name is not None else ""
        if not ecd and not ename:
            continue

        if sy_series is not None:
            raw_year = sy_series.iat[i]
            sy = year_transform(raw_year) if year_transform else str(raw_year).strip()
        else:
            sy = school_year
        if not sy:
            continue
        # Drop snapshots outside the dataset year being processed (see melt_specs):
        # folder_year_only restricts to the folder's own year, else just future.
        if sy_series is not None and school_year:
            if folder_year_only:
                if sy != school_year:
                    continue
            elif sy > school_year:
                continue

        subgroup = canon_subgroup(sub_series.iat[i]) if sub_series is not None else ALL_STUDENTS

        code_suffix, name_suffix, skip_row = "", "", False
        for series, fn in dim_series:
            if series is None:
                continue
            dim = fn(series.iat[i])
            if dim is None:
                skip_row = True
                break
            code_suffix += dim[0]
            name_suffix += dim[1]
        if skip_row:
            continue

        for col, base in present.items():
            num, text, skip = parse_value(value_series[col].iat[i])
            if skip:
                continue
            key = (base.code, code_suffix)
            spec = spec_cache.get(key)
            if spec is None:
                spec = (
                    base
                    if not code_suffix
                    else replace(base, code=base.code + code_suffix, name=base.name + (name_suffix or ""))
                )
                spec_cache[key] = spec
            records.append(
                FactRecord(
                    entity_cd=ecd,
                    entity_name=ename,
                    metric=spec,
                    school_year=sy,
                    subgroup=subgroup,
                    value_numeric=num,
                    value_text=text,
                )
            )
    return records
