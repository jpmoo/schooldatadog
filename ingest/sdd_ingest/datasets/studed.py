"""Student & Educator database — several small tables in one file.

Attendance, suspensions, free/reduced lunch, instructional modalities and staff
are plain wide tables (multi-year via YEAR). Average class size is row-based:
CLASS_DESCRIPTION is a dimension folded into the metric code.
"""

from __future__ import annotations

import re
from typing import List, Optional, Tuple

from ..mdb import find_table, read_table
from ..melt import melt_rows, melt_specs
from ..model import FactRecord, MetricSpec
from ..values import school_year_from_fall

SOURCE = "NYSED Student & Educator"
CATEGORY = "Students & Educators"


def _c(code: str, name: str) -> MetricSpec:
    return MetricSpec(code, name, CATEGORY, "count", None, None, SOURCE)


def _p(code: str, name: str) -> MetricSpec:
    return MetricSpec(code, name, CATEGORY, "percent", "%", None, SOURCE)


# table name -> (entity_name_col, {column: (MetricSpec, subgroup=None)})
_WIDE_TABLES = {
    "Attendance": ("ENTITY_NAME", {
        "ATTENDANCE_RATE": (_p("studed_attendance_rate", "Student attendance rate"), None),
    }),
    "Suspensions": ("ENTITY_NAME", {
        "NUM_SUSPENSIONS": (_c("studed_suspensions_count", "Suspensions"), None),
        "PER_SUSPENSIONS": (_p("studed_suspensions_pct", "Suspension rate"), None),
    }),
    "Free Reduced Price Lunch": ("ENTITY_NAME", {
        "NUM_FREE_LUNCH": (_c("studed_free_lunch_count", "Free lunch eligible"), None),
        "PER_FREE_LUNCH": (_p("studed_free_lunch_pct", "Free lunch eligible %"), None),
        "NUM_REDUCED_LUNCH": (_c("studed_reduced_lunch_count", "Reduced-price lunch eligible"), None),
        "PER_REDUCED_LUNCH": (_p("studed_reduced_lunch_pct", "Reduced-price lunch eligible %"), None),
    }),
    "Instructional_Modalities": ("ENTITY_NAME", {
        "REMOTE": (_c("studed_modality_remote_count", "Remote instruction (student-days)"), None),
        "PER_REMOTE": (_p("studed_modality_remote_pct", "Remote instruction %"), None),
        "IN_PERSON": (_c("studed_modality_in_person_count", "In-person instruction (student-days)"), None),
        "PER_IN_PERSON": (_p("studed_modality_in_person_pct", "In-person instruction %"), None),
        "BOTH": (_c("studed_modality_hybrid_count", "Hybrid instruction (student-days)"), None),
        "PER_BOTH": (_p("studed_modality_hybrid_pct", "Hybrid instruction %"), None),
    }),
    "Staff": ("SCHOOL_NAME", {
        "NUM_PRINC": (_c("studed_principals_count", "Principals"), None),
        "NUM_TEACH": (_c("studed_teachers_count", "Teachers"), None),
        "NUM_COUNSELORS": (_c("studed_counselors_count", "School counselors"), None),
        "NUM_SOCIAL": (_c("studed_social_workers_count", "Social workers"), None),
        "PER_ATTEND": (_p("studed_teacher_attendance_pct", "Teacher attendance rate"), None),
        "PER_TURN_ALL": (_p("studed_teacher_turnover_pct", "Teacher turnover rate"), None),
        "PER_TURN_FIVE_YRS": (_p("studed_teacher_turnover_5yr_pct", "Teacher turnover (<5 yrs) rate"), None),
    }),
}


def _class_dim(desc: str) -> Optional[Tuple[str, str]]:
    d = str(desc).strip()
    if not d:
        return None
    slug = re.sub(r"[^a-z0-9]+", "_", d.lower()).strip("_")
    return (f"_{slug}", f" — {d}")


def build(path: str, school_year: str, dict_path: str | None = None) -> List[FactRecord]:
    # dict_path unused for now — the 2022-23 readme is a legacy .doc; the
    # columns are hand-described. (2024-25 ships a PDF we can wire later.)
    records: List[FactRecord] = []

    for table_hint, (name_col, specs) in _WIDE_TABLES.items():
        table = find_table(path, table_hint)
        if table is None:
            print(f"  note: table '{table_hint}' not found — skipping")
            continue
        df = read_table(path, table)
        records += melt_specs(
            df, "ENTITY_CD", name_col, school_year, specs,
            year_col="YEAR", year_transform=school_year_from_fall, folder_year_only=True,
        )

    # Average class size — row-based on CLASS_DESCRIPTION.
    acs = find_table(path, "Average Class Size")
    if acs is not None:
        df = read_table(path, acs)
        records += melt_rows(
            df,
            entity_cd_col="ENTITY_CD",
            entity_name_col="ENTITY_NAME",
            value_specs={"AVERAGE_CLASS_SIZE": _c("studed_avg_class_size", "Average class size")},
            school_year=school_year,
            school_year_col="YEAR",
            year_transform=school_year_from_fall,
            folder_year_only=True,  # keep only this folder's own year
            dimension_col="CLASS_DESCRIPTION",
            dimension_fn=_class_dim,
        )

    return records
