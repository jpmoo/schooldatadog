"""BEDS Day Enrollment — Demographic Factors: enrollment composition.

A plain wide table (one row per entity, per fall year) with NUM_<group> and
PER_<group> columns giving the count and percentage of enrollment in each
demographic group (race/ethnicity, gender, students with disabilities,
economically disadvantaged, ELL, and a few status groups). Each column becomes
its own "All Students" metric — the group *is* the datapoint here.

Lives in the same Access DB as the grade-level enrollment table.
"""

from __future__ import annotations

from typing import List

from ..mdb import find_table, read_table
from ..melt import melt_specs
from ..model import FactRecord, MetricSpec
from ..values import school_year_from_fall

SOURCE = "NYSED BEDS Day Enrollment"
CATEGORY = "Demographics"

# NYSED column key -> human label. Column case is matched exactly against the
# Access table (note the mixed-case "Multi").
_GROUPS = {
    "AM_IND": "American Indian or Alaska Native",
    "BLACK": "Black or African American",
    "HISP": "Hispanic or Latino",
    "ASIAN": "Asian or Native Hawaiian/Other Pacific Islander",
    "WHITE": "White",
    "MULTI": "Multiracial",
    "FEMALE": "Female",
    "MALE": "Male",
    "NONBINARY": "Non-Binary",
    "SWD": "Students with Disabilities",
    "ECDIS": "Economically Disadvantaged",
    "ELL": "English Language Learners",
    "MIGRANT": "Migrant",
    "HOMELESS": "Homeless",
    "FOSTER": "In Foster Care",
    "ARMED": "Parent in Armed Forces",
}


def _specs():
    specs = {}
    for key, label in _GROUPS.items():
        slug = key.lower()
        specs[f"NUM_{key}"] = (
            MetricSpec(
                code=f"demo_{slug}_count",
                name=f"{label} (count)",
                category=CATEGORY,
                data_type="count",
                unit="students",
                description=f"Number of enrolled students who are {label}.",
                source=SOURCE,
            ),
            None,  # no subgroup — the group is the metric
        )
        specs[f"PER_{key}"] = (
            MetricSpec(
                code=f"demo_{slug}_pct",
                name=f"{label} (% of enrollment)",
                category=CATEGORY,
                data_type="percent",
                unit="%",
                description=f"Percentage of enrolled students who are {label}.",
                source=SOURCE,
            ),
            None,
        )
    return specs


def build(path: str, school_year: str, dict_path: str | None = None) -> List[FactRecord]:
    # Self-describing columns, so dict_path is unused. The file carries several
    # fall snapshots (YEAR); keep only this folder's own school year so we don't
    # leak a sparse adjacent year (e.g. a future 2025-26 or an older 2021-22).
    table = find_table(path, "Demographic Factors") or "Demographic Factors"
    df = read_table(path, table)
    if "YEAR" in df.columns:
        df = df[df["YEAR"].map(lambda y: school_year_from_fall(y) == school_year)]
    return melt_specs(df, "ENTITY_CD", "ENTITY_NAME", school_year, _specs())
