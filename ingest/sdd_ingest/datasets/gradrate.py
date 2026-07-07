"""Graduation Rate & Outcomes.

Row-based: entity is `aggregation_code`/`aggregation_name`, `subgroup_name` is a
row value, and `membership_desc` encodes the cohort outcome (4/5/6-year, June or
August) which folds into the metric code. Measures are graduation, diploma-type,
dropout, GED, and still-enrolled counts and percentages.
"""

from __future__ import annotations

from dataclasses import replace
from typing import List, Optional, Tuple

from .. import dictionaries as D
from ..mdb import find_table, list_tables, read_table
from ..melt import melt_rows
from ..model import FactRecord, MetricSpec
from ..nysed import cohort_dimension

SOURCE = "NYSED Graduation Rate & Outcomes"
CATEGORY = "Graduation Rate & Outcomes"


def _c(code: str, name: str) -> MetricSpec:
    return MetricSpec(code, name, CATEGORY, "count", "students", None, SOURCE)


def _p(code: str, name: str) -> MetricSpec:
    return MetricSpec(code, name, CATEGORY, "percent", "%", None, SOURCE)


# measure column -> base metric (a cohort-outcome suffix is appended per row)
_MEASURES = {
    "enroll_cnt": _c("gradrate_cohort_count", "Cohort size"),
    "grad_cnt": _c("gradrate_grad_count", "Graduates"),
    "grad_pct": _p("gradrate_grad_pct", "Graduation rate"),
    "local_cnt": _c("gradrate_local_diploma_count", "Local diplomas"),
    "local_pct": _p("gradrate_local_diploma_pct", "Local diploma rate"),
    "reg_cnt": _c("gradrate_regents_count", "Regents diplomas"),
    "reg_pct": _p("gradrate_regents_pct", "Regents diploma rate"),
    "reg_adv_cnt": _c("gradrate_regents_advanced_count", "Regents Advanced diplomas"),
    "reg_adv_pct": _p("gradrate_regents_advanced_pct", "Regents Advanced diploma rate"),
    "non_diploma_credential_cnt": _c("gradrate_non_diploma_credential_count", "Non-diploma credentials"),
    "non_diploma_credential_pct": _p("gradrate_non_diploma_credential_pct", "Non-diploma credential rate"),
    "still_enr_cnt": _c("gradrate_still_enrolled_count", "Still enrolled"),
    "still_enr_pct": _p("gradrate_still_enrolled_pct", "Still-enrolled rate"),
    "ged_cnt": _c("gradrate_hse_count", "High School Equivalency (GED)"),
    "ged_pct": _p("gradrate_hse_pct", "High School Equivalency (GED) rate"),
    "dropout_cnt": _c("gradrate_dropout_count", "Dropouts"),
    "dropout_pct": _p("gradrate_dropout_pct", "Dropout rate"),
}


def build(path: str, school_year: str, dict_path: str | None = None) -> List[FactRecord]:
    # Table name varies by year (GRAD_RATE_AND_OUTCOMES_2023, 2024_GRADUATION_RATE,
    # "2025 High School Graduation Rate Researcher File"); the file has one table.
    table = (
        find_table(path, "GRAD_RATE")
        or find_table(path, "GRADUATION_RATE")
        or find_table(path, "Graduation Rate")
        or list_tables(path)[0]
    )
    df = read_table(path, table)

    # Columns are upper-cased at read; measure keys and descriptions key off the
    # raw measure column (ENROLL_CNT, GRAD_PCT…). The cohort suffix inherits the
    # base metric's description.
    descs = D.from_pdf_fields(dict_path) if dict_path else {}
    measures = {
        col.upper(): replace(m, description=descs.get(col.upper()) or m.description)
        for col, m in _MEASURES.items()
    }

    return melt_rows(
        df,
        entity_cd_col="AGGREGATION_CODE",
        entity_name_col="AGGREGATION_NAME",
        value_specs=measures,
        school_year_col="REPORT_SCHOOL_YEAR",
        subgroup_col="SUBGROUP_NAME",
        dimension_col="MEMBERSHIP_DESC",
        dimension_fn=cohort_dimension,
    )
