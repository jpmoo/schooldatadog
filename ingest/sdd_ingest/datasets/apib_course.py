"""AP / IB course participation.

Two source layouts appear across years, both aggregated to subject-area level:
  * Old (2022-23): fully-crossed atomic cells (gender × ethnicity × status flags)
    keyed by STATE_LOCATION_ID. Clean single-dimension subgroups are rebuilt from
    the atomic indicator columns.
  * New (2024+): row-based by SUBGROUP_NAME keyed by AGGREGATION_CODE (like the
    assessment table); crossed combos are filtered to the standard subgroups.
"""

from __future__ import annotations

from typing import Dict, List, Tuple

import pandas as pd

from ..mdb import find_table, list_tables, read_table
from ..model import FactRecord, MetricSpec
from ..nysed import slugify
from ..subgroups import STANDARD_SUBGROUPS, canon_subgroup
from ..values import parse_value

SOURCE = "NYSED Advanced Placement / International Baccalaureate"
CATEGORY = "AP / IB"

# status column -> canonical subgroup (old atomic layout; rows where flag == "1")
_FLAGS = {
    "SWD_IND": "Students with Disabilities",
    "ELL_IND": "English Language Learners",
    "ECODIS_IND": "Economically Disadvantaged",
    "HOMELESS_IND": "Homeless",
    "FOSTER_IND": "In Foster Care",
    "ARMED_IND": "Parent in Armed Forces",
}


def _num(v):
    n, _t, skip = parse_value(v)
    return None if (skip or n is None) else n


def _spec(cache, program, subject):
    key = (program, subject)
    s = cache.get(key)
    if s is None:
        s = MetricSpec(
            code=f"apib_participation_{program.lower()}_{slugify(subject)}",
            name=f"{program} participation — {subject}",
            category=CATEGORY, data_type="count", unit="students",
            description=f"Number of {program} course enrollments in {subject}.",
            source=SOURCE,
        )
        cache[key] = s
    return s


def _atomic(df: pd.DataFrame, school_year: str) -> List[FactRecord]:
    keys = ["STATE_LOCATION_ID", "LOCATION_NAME", "APIB_IND", "SUBJECT_AREA"]
    df["VAL"] = df["STUDENT_COUNT"].map(_num)
    df = df[df["VAL"].notna() & df["SUBJECT_AREA"].astype(str).str.strip().ne("")]

    cache: Dict[Tuple[str, str], MetricSpec] = {}
    records: List[FactRecord] = []

    def emit(frame: pd.DataFrame, subgroup: str) -> None:
        if frame.empty:
            return
        g = frame.groupby(keys, as_index=False)["VAL"].sum()
        for r in g.itertuples(index=False):
            ecd = str(r.STATE_LOCATION_ID).strip()
            if not ecd:
                continue
            program = str(r.APIB_IND).strip().upper() or "AP"
            records.append(FactRecord(ecd, str(r.LOCATION_NAME).strip(),
                                      _spec(cache, program, str(r.SUBJECT_AREA).strip()),
                                      school_year, subgroup, float(r.VAL), None))

    emit(df, "All Students")
    for gender in ("Female", "Male", "Nonbinary"):
        emit(df[df["STUDENT_GENDER"].astype(str).str.strip() == gender], canon_subgroup(gender))
    for race in df["ETHNIC_DESC_RC"].dropna().unique():
        if str(race).strip():
            emit(df[df["ETHNIC_DESC_RC"] == race], canon_subgroup(race))
    for col, label in _FLAGS.items():
        if col in df.columns:
            emit(df[df[col].astype(str).str.strip() == "1"], label)
    return records


def _row_based(df: pd.DataFrame, school_year: str) -> List[FactRecord]:
    keys = ["AGGREGATION_CODE", "AGGREGATION_NAME", "SUBGROUP_NAME", "APIB_IND", "SUBJECT_AREA"]
    df["VAL"] = df["STUDENT_COUNT"].map(_num)
    df = df[df["VAL"].notna() & df["SUBJECT_AREA"].astype(str).str.strip().ne("")]
    df = df[df["SUBGROUP_NAME"].map(lambda s: canon_subgroup(s) in STANDARD_SUBGROUPS)]

    grouped = df.groupby(keys, as_index=False)["VAL"].sum()
    cache: Dict[Tuple[str, str], MetricSpec] = {}
    records: List[FactRecord] = []
    for r in grouped.itertuples(index=False):
        ecd = str(r.AGGREGATION_CODE).strip()
        if not ecd:
            continue
        program = str(r.APIB_IND).strip().upper() or "AP"
        records.append(FactRecord(ecd, str(r.AGGREGATION_NAME).strip(),
                                  _spec(cache, program, str(r.SUBJECT_AREA).strip()),
                                  school_year, canon_subgroup(r.SUBGROUP_NAME), float(r.VAL), None))
    return records


def build(path: str, school_year: str, dict_path: str | None = None) -> List[FactRecord]:
    table = find_table(path, "Course_Summary") or find_table(path, "Course") or list_tables(path)[0]
    df = read_table(path, table)
    if "SUBGROUP_NAME" in df.columns and "AGGREGATION_CODE" in df.columns:
        return _row_based(df, school_year)
    return _atomic(df, school_year)
