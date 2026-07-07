"""English Language Learners (ELL) enrollment.

This dataset carries demographic breakdowns as *columns* (NUM_BLACK, PER_MALE…).
The hybrid model pulls those into facts.subgroup: NUM_/PER_ demographic columns
collapse onto two metrics (count + percent) with the subgroup set per column,
instead of one metric per demographic. Grade breakdowns fold into the metric
code; program/status counts are "All Students".
"""

from __future__ import annotations

from dataclasses import replace
from typing import Dict, List

from .. import dictionaries as D
from ..mdb import find_table, read_table
from ..melt import ColumnSpecs, melt_specs
from ..model import FactRecord, MetricSpec
from ..subgroups import ALL_STUDENTS, canon_subgroup

SOURCE = "NYSED English Language Learners (ELL)"
CATEGORY = "English Language Learners"

# Demographic subgroup tokens that appear as NUM_<TOK>/PER_<TOK> pairs.
_DEMO = [
    "MALE", "FEMALE", "NONBINARY",
    "AM_IND", "BLACK", "HISP", "ASIAN", "WHITE", "MULTI",
    "SWD", "ECDIS",
]

# Grade token -> (GRADE_ column, PER_ column, label)
_GRADES = [
    ("KHALF", "GRADE_KHALF", "PER_KHALF", "Kindergarten half-day"),
    ("KFULL", "GRADE_KFULL", "PER_KFULL", "Kindergarten full-day"),
    ("1", "GRADE_1", "PER_1ST", "Grade 1"),
    ("2", "GRADE_2", "PER_2ND", "Grade 2"),
    ("3", "GRADE_3", "PER_3RD", "Grade 3"),
    ("4", "GRADE_4", "PER_4TH", "Grade 4"),
    ("5", "GRADE_5", "PER_5TH", "Grade 5"),
    ("6", "GRADE_6", "PER_6TH", "Grade 6"),
    ("7", "GRADE_7", "PER_7TH", "Grade 7"),
    ("8", "GRADE_8", "PER_8TH", "Grade 8"),
    ("9", "GRADE_9", "PER_9TH", "Grade 9"),
    ("10", "GRADE_10", "PER_10TH", "Grade 10"),
    ("11", "GRADE_11", "PER_11TH", "Grade 11"),
    ("12", "GRADE_12", "PER_12TH", "Grade 12"),
    ("uge", "GRADE_UGE", "PER_UGE", "Ungraded Elementary"),
    ("ugs", "GRADE_UGS", "PER_UGS", "Ungraded Secondary"),
]

# Program / status count columns (All Students).
_PROGRAMS = {
    "NEWCOMER": ("ell_newcomer_count", "Newcomer ELLs"),
    "DEVELOPING": ("ell_developing_count", "Developing ELLs"),
    "LONG_TERM": ("ell_long_term_count", "Long-Term ELLs"),
    "SIFE": ("ell_sife_count", "Students with Interrupted/Inconsistent Formal Education (SIFE)"),
    "ENG_NEW_LANG": ("ell_program_enl_count", "English as a New Language (ENL) program"),
    "ONE_TWO_WAY_DUAL_LANG": ("ell_program_dual_language_count", "Dual Language program"),
    "TRAN_BILING_ED": ("ell_program_transitional_bilingual_count", "Transitional Bilingual Education program"),
}

_COUNT = MetricSpec(
    code="ell_enrollment",
    name="ELL Enrollment (count)",
    category=CATEGORY,
    data_type="count",
    unit="students",
    description="Number of English Language Learners.",
    source=SOURCE,
)
_PCT = MetricSpec(
    code="ell_enrollment_pct",
    name="ELL Enrollment (% of ELL population)",
    category=CATEGORY,
    data_type="percent",
    unit="%",
    description="Share of the ELL population.",
    source=SOURCE,
)


def _specs(descs: Dict[str, str]) -> ColumnSpecs:
    specs: ColumnSpecs = {}

    # Base count/percent (shared across demographic subgroups). The count's
    # description comes from the total-ELL column; the percent stays generic
    # since each subgroup column describes a different share.
    count = replace(_COUNT, description=descs.get("NUM_TOTAL_ELL", _COUNT.description))

    # Totals
    specs["NUM_TOTAL_ELL"] = (count, ALL_STUDENTS)
    specs["NUM_FORMER_ELL"] = (
        MetricSpec("ell_former_count", "Former ELLs (count)", CATEGORY, "count", "students",
                   descs.get("NUM_FORMER_ELL", "Students who have exited ELL status."), SOURCE),
        ALL_STUDENTS,
    )

    # Demographic subgroups -> count + percent metrics, subgroup per column
    for tok in _DEMO:
        sub = canon_subgroup(tok)
        specs[f"NUM_{tok}"] = (count, sub)
        specs[f"PER_{tok}"] = (_PCT, sub)

    # Grade breakdowns -> folded into the metric code, All Students
    for slug, num_col, pct_col, label in _GRADES:
        specs[num_col] = (
            MetricSpec(f"ell_enrollment_grade_{slug}", f"ELL Enrollment — {label} (count)",
                       CATEGORY, "count", "students", descs.get(num_col.upper()), SOURCE),
            ALL_STUDENTS,
        )
        specs[pct_col] = (
            MetricSpec(f"ell_enrollment_grade_{slug}_pct", f"ELL Enrollment — {label} (%)",
                       CATEGORY, "percent", "%", descs.get(pct_col.upper()), SOURCE),
            ALL_STUDENTS,
        )

    # Program / status counts
    for col, (code, label) in _PROGRAMS.items():
        specs[col] = (
            MetricSpec(code, f"ELL — {label}", CATEGORY, "count", "students",
                       descs.get(col.upper()), SOURCE),
            ALL_STUDENTS,
        )

    return specs


def build(path: str, school_year: str, dict_path: str | None = None) -> List[FactRecord]:
    table = find_table(path, "ELL Enrollment")
    if table is None:
        raise RuntimeError(f"No 'ELL Enrollment' table found in {path}")
    df = read_table(path, table)
    descs = D.from_xlsx(dict_path, "ELL Enrollment", "Variable Name", ["Description"]) if dict_path else {}
    return melt_specs(df, "ENTITY_CD", "ENTITY_NAME", school_year, _specs(descs))
