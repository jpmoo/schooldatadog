"""Graduation / Career Pathways.

Row-based like graduation rate, but the metric identity comes from the
COURSE_OF_STUDY (Arts, CTE, STEM-Science…) pathway and the single value column
is STUDENT_COUNT. Two dimensions fold into the metric code: the pathway and the
cohort outcome (4/5/6-year, June/August). Subgroup is a row value.
"""

from __future__ import annotations

from typing import List, Optional, Tuple

from ..mdb import find_table, list_tables, read_table
from ..melt import melt_rows
from ..model import FactRecord, MetricSpec
from ..nysed import cohort_dimension, slugify

SOURCE = "NYSED Graduation Pathways"
CATEGORY = "Graduation Pathways"

_BASE = MetricSpec(
    code="pathways_students",
    name="Graduation Pathway",
    category=CATEGORY,
    data_type="count",
    unit="students",
    description="Number of students in the cohort who satisfied this graduation pathway option.",
    source=SOURCE,
)


def _pathway_dimension(label: str) -> Optional[Tuple[str, str]]:
    label = str(label).strip()
    if not label:
        return None
    return (f"_{slugify(label)}", f" — {label}")


def build(path: str, school_year: str, dict_path: str | None = None) -> List[FactRecord]:
    table = find_table(path, "Pathway") or list_tables(path)[0]
    df = read_table(path, table)
    return melt_rows(
        df,
        entity_cd_col="AGGREGATION_CODE",
        entity_name_col="AGGREGATION_NAME",
        value_specs={"STUDENT_COUNT": _BASE},
        school_year_col="REPORT_SCHOOL_YEAR",
        subgroup_col="SUBGROUP_NAME",
        dimensions=[
            ("COURSE_OF_STUDY", _pathway_dimension),
            ("MEMBERSHIP_DESC", cohort_dimension),
        ],
    )
