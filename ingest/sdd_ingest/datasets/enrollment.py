"""BEDS Day Enrollment — a plain wide table (one column per grade level).

Each grade column becomes its own metric; there is no subgroup breakdown here,
so every fact is "All Students".
"""

from __future__ import annotations

from typing import List

from ..mdb import find_table, read_table
from ..melt import melt_specs
from ..model import FactRecord, MetricSpec
from ..values import school_year_from_fall

LABEL = "BEDS Day Enrollment"
SOURCE = "NYSED BEDS Day Enrollment"
CATEGORY = "Enrollment"

# Access column -> human label for the grade level.
_GRADE_LABELS = {
    "PK": "Pre-K (total)",
    "PKHALF": "Pre-K half-day",
    "PKFULL": "Pre-K full-day",
    "KHALF": "Kindergarten half-day",
    "KFULL": "Kindergarten full-day",
    "1": "Grade 1",
    "2": "Grade 2",
    "3": "Grade 3",
    "4": "Grade 4",
    "5": "Grade 5",
    "6": "Grade 6",
    "7": "Grade 7",
    "8": "Grade 8",
    "9": "Grade 9",
    "10": "Grade 10",
    "11": "Grade 11",
    "12": "Grade 12",
    "UGE": "Ungraded Elementary",
    "UGS": "Ungraded Secondary",
    "K12": "Total K-12",
}


def _specs():
    specs = {}
    for col, label in _GRADE_LABELS.items():
        code = f"enroll_grade_{col.lower()}" if col not in {"K12"} else "enroll_total_k12"
        specs[col] = (
            MetricSpec(
                code=code,
                name=f"Enrollment — {label}",
                category=CATEGORY,
                data_type="count",
                unit="students",
                description=f"BEDS day enrollment count for {label}.",
                source=SOURCE,
            ),
            None,  # no subgroup
        )
    return specs


def build(path: str, school_year: str, dict_path: str | None = None) -> List[FactRecord]:
    # This table carries several fall-year snapshots; derive the school year
    # per row from YEAR instead of using the folder label.
    # (Grade columns are already self-describing, so dict_path is unused here.)
    table = find_table(path, "BEDS Day Enrollment") or "BEDS Day Enrollment"
    df = read_table(path, table)
    return melt_specs(
        df, "ENTITY_CD", "ENTITY_NAME", school_year, _specs(),
        year_col="YEAR", year_transform=school_year_from_fall,
    )
