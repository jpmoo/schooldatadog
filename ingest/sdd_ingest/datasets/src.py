"""School Report Card (SRC) — the big multi-table dataset.

Covers the highest-value tables for comparison: grades 3-8 ELA/Math/Science
proficiency, Regents exams, per-pupil spending, postsecondary enrollment,
chronic absenteeism, and teacher/principal experience. Each table is mapped with
the shared wide (`melt_specs`) or row-based (`melt_rows`) engines. Each SRC file
holds two school years; the school year is derived per row from the YEAR column
(NYSED labels a year by the calendar year it ends: 2023 -> "2022-23").
"""

from __future__ import annotations

from typing import List

from ..mdb import find_table, read_table
from ..melt import melt_rows, melt_specs
from ..model import FactRecord, MetricSpec
from ..nysed import grade_dimension, label_dimension
from ..values import school_year_from_ending

SOURCE = "NYSED School Report Card"


def _c(code, name, cat, unit="students"):
    return MetricSpec(code, name, cat, "count", unit, None, SOURCE)


def _p(code, name, cat):
    return MetricSpec(code, name, cat, "percent", "%", None, SOURCE)


def _n(code, name, cat, unit=None):
    return MetricSpec(code, name, cat, "numeric", unit, None, SOURCE)


def _cur(code, name, cat):
    return MetricSpec(code, name, cat, "currency", "$", None, SOURCE)


# --- Grades 3-8 assessments (ELA / Math / Science) -------------------------
_EM_CAT = "Assessments (Grades 3-8)"


def _em_assessment(path, table, prefix, subject, school_year):
    df = read_table(path, table)
    measures = {
        "NUM_TESTED": _c(f"src_{prefix}_tested_count", f"{subject} — students tested", _EM_CAT),
        "PCT_TESTED": _p(f"src_{prefix}_tested_pct", f"{subject} — participation rate", _EM_CAT),
        "NUM_PROF": _c(f"src_{prefix}_proficient_count", f"{subject} — proficient (Level 3-4)", _EM_CAT),
        "PER_PROF": _p(f"src_{prefix}_proficient_pct", f"{subject} — proficiency rate", _EM_CAT),
        "MEAN_SCORE": _n(f"src_{prefix}_mean_score", f"{subject} — mean scale score", _EM_CAT),
    }
    return melt_rows(
        df, "ENTITY_CD", "ENTITY_NAME", measures,
        school_year=school_year, school_year_col="YEAR", year_transform=school_year_from_ending,
        subgroup_col="SUBGROUP_NAME",
        dimension_col="ASSESSMENT_NAME", dimension_fn=grade_dimension,
    )


# --- Regents exams ----------------------------------------------------------
_REG_CAT = "Regents Exams"


def _regents(path, school_year):
    t = find_table(path, "Annual Regents Exams")
    if not t:
        return []
    df = read_table(path, t)
    measures = {
        "TESTED": _c("src_regents_tested_count", "Regents — students tested", _REG_CAT),
        "NUM_PROF": _c("src_regents_proficient_count", "Regents — proficient (65+)", _REG_CAT),
        "PER_PROF": _p("src_regents_proficient_pct", "Regents — proficiency rate", _REG_CAT),
    }
    return melt_rows(
        df, "ENTITY_CD", "ENTITY_NAME", measures,
        school_year=school_year, school_year_col="YEAR", year_transform=school_year_from_ending,
        subgroup_col="SUBGROUP_NAME",
        dimension_col="SUBJECT", dimension_fn=label_dimension,
    )


# --- Per-pupil spending -----------------------------------------------------
_EXP_CAT = "Spending"


def _expenditures(path, school_year):
    t = find_table(path, "Expenditures per Pupil")
    if not t:
        return []
    df = read_table(path, t)
    specs = {
        "PER_FED_STATE_LOCAL_EXP": (_cur("src_exp_per_pupil_total", "Per-pupil spending — total", _EXP_CAT), None),
        "PER_FEDERAL_EXP": (_cur("src_exp_per_pupil_federal", "Per-pupil spending — federal", _EXP_CAT), None),
        "PER_STATE_LOCAL_EXP": (_cur("src_exp_per_pupil_state_local", "Per-pupil spending — state & local", _EXP_CAT), None),
        "FED_STATE_LOCAL_EXP": (_cur("src_exp_total", "Total expenditure", _EXP_CAT), None),
        "PUPIL_COUNT_TOT": (_c("src_exp_pupil_count", "Pupil count (for spending)", _EXP_CAT), None),
    }
    return melt_specs(df, "ENTITY_CD", "ENTITY_NAME", school_year, specs,
                      year_col="YEAR", year_transform=school_year_from_ending)


# --- Postsecondary enrollment ----------------------------------------------
_PS_CAT = "Postsecondary Enrollment"


def _postsecondary(path, school_year):
    t = find_table(path, "Postsecondary Enrollment")
    if not t:
        return []
    df = read_table(path, t)
    measures = {
        "TOTAL_GRAD_COUNT": _c("src_postsec_grad_count", "Graduates (postsecondary cohort)", _PS_CAT),
        "PER_NYS_PUB_2_YR": _p("src_postsec_ny_public_2yr_pct", "Enrolled — NY public 2-year", _PS_CAT),
        "PER_NYS_PUB_4_YR": _p("src_postsec_ny_public_4yr_pct", "Enrolled — NY public 4-year", _PS_CAT),
        "PER_NYS_PVT_4_YR": _p("src_postsec_ny_private_4yr_pct", "Enrolled — NY private 4-year", _PS_CAT),
        "PER_OUT_4_YR": _p("src_postsec_out_of_state_4yr_pct", "Enrolled — out-of-state 4-year", _PS_CAT),
    }
    return melt_rows(
        df, "ENTITY_CD", "ENTITY_NAME", measures,
        school_year=school_year, school_year_col="YEAR", year_transform=school_year_from_ending,
        subgroup_col="SUBGROUP_NAME",
        dimension_col="MEMBERSHIP_DESC", dimension_fn=label_dimension,
    )


# --- Chronic absenteeism (EM + HS) -----------------------------------------
_ABS_CAT = "Chronic Absenteeism"


def _absenteeism(path, school_year):
    out: List[FactRecord] = []
    measures = {
        "ABSENT_RATE": _p("src_chronic_absentee_rate", "Chronic absenteeism rate", _ABS_CAT),
        "ABSENT_COUNT": _c("src_chronic_absentee_count", "Chronically absent students", _ABS_CAT),
        "ENROLLMENT": _c("src_absentee_enrollment", "Enrollment (absenteeism)", _ABS_CAT),
    }
    for hint in ("ACC EM Chronic Absenteeism", "ACC HS Chronic Absenteeism"):
        t = find_table(path, hint)
        if not t:
            continue
        df = read_table(path, t)
        out += melt_rows(
            df, "ENTITY_CD", "ENTITY_NAME", measures,
            school_year=school_year, school_year_col="YEAR", year_transform=school_year_from_ending,
        subgroup_col="SUBGROUP_NAME",
        )
    return out


# --- Teacher / principal experience ----------------------------------------
_TQ_CAT = "Teacher Quality"


def _teacher_quality(path, school_year):
    t = find_table(path, "Inexperienced Teachers and Principals")
    if not t:
        return []
    df = read_table(path, t)
    specs = {
        "NUM_TEACH": (_c("src_teachers_count", "Teachers", _TQ_CAT), None),
        "PER_TEACH_INEXP": (_p("src_teachers_inexperienced_pct", "Inexperienced teachers rate", _TQ_CAT), None),
        "PER_PRINC_INEXP": (_p("src_principals_inexperienced_pct", "Inexperienced principals rate", _TQ_CAT), None),
    }
    return melt_specs(df, "ENTITY_CD", "ENTITY_NAME", school_year, specs,
                      year_col="YEAR", year_transform=school_year_from_ending)


def build(path: str, school_year: str, dict_path: str | None = None) -> List[FactRecord]:
    records: List[FactRecord] = []

    for hint, prefix, subject in (
        ("Annual EM ELA", "em_ela", "Grades 3-8 ELA"),
        ("Annual EM MATH", "em_math", "Grades 3-8 Math"),
        ("Annual EM SCIENCE", "em_science", "Grades 3-8 Science"),
    ):
        t = find_table(path, hint)
        if t:
            records += _em_assessment(path, t, prefix, subject, school_year)

    records += _regents(path, school_year)
    records += _expenditures(path, school_year)
    records += _postsecondary(path, school_year)
    records += _absenteeism(path, school_year)
    records += _teacher_quality(path, school_year)
    return records
