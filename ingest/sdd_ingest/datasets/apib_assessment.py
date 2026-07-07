"""AP / IB assessment outcomes.

Per-exam scores aggregated to the subject-area level: students tested and
students proficient (AP 3+/IB 4+), summed across exams within AP-vs-IB × subject.
Per-exam score-level columns aren't summed (they mean different things across
exams). Subgroup stays a dimension.
"""

from __future__ import annotations

from typing import Dict, List, Tuple

from ..mdb import find_table, list_tables, read_table
from ..model import FactRecord, MetricSpec
from ..nysed import slugify
from ..subgroups import STANDARD_SUBGROUPS, canon_subgroup
from ..values import parse_value

SOURCE = "NYSED Advanced Placement / International Baccalaureate"
CATEGORY = "AP / IB"

# aggregated measure column -> (code stem, label)
_MEASURES = {
    "TESTED_STUDENT_CNT": ("tested", "students tested"),
    "PROFICIENT_STUDENT_CNT": ("proficient", "students proficient"),
}


def _num(v):
    n, _text, skip = parse_value(v)
    return None if (skip or n is None) else n


def build(path: str, school_year: str, dict_path: str | None = None) -> List[FactRecord]:
    table = find_table(path, "Assessment") or list_tables(path)[0]
    df = read_table(path, table)

    # Subject column was renamed ITEM_SUBJECT_AREA -> SUBJECT_AREA between years.
    subject_col = "ITEM_SUBJECT_AREA" if "ITEM_SUBJECT_AREA" in df.columns else "SUBJECT_AREA"
    keys = ["AGGREGATION_CODE", "AGGREGATION_NAME", "SUBGROUP_NAME", "APIB_IND", subject_col]
    measures = list(_MEASURES)
    df = df[keys + measures].copy()
    for m in measures:
        df[m] = df[m].map(_num)
    df = df[df[subject_col].astype(str).str.strip().ne("")]
    df = df[df["SUBGROUP_NAME"].map(lambda s: canon_subgroup(s) in STANDARD_SUBGROUPS)]

    grouped = df.groupby(keys, as_index=False)[measures].sum(min_count=1)

    spec_cache: Dict[Tuple[str, str, str], MetricSpec] = {}
    records: List[FactRecord] = []
    for r in grouped.itertuples(index=False):
        ecd = str(r.AGGREGATION_CODE).strip()
        if not ecd:
            continue
        program = str(r.APIB_IND).strip().upper() or "AP"
        subject = str(getattr(r, subject_col)).strip()
        subgroup = canon_subgroup(r.SUBGROUP_NAME)
        ename = str(r.AGGREGATION_NAME).strip()
        for col, (stem, label) in _MEASURES.items():
            val = getattr(r, col)
            if val is None or (isinstance(val, float) and val != val):  # NaN
                continue
            key = (program, subject, stem)
            spec = spec_cache.get(key)
            if spec is None:
                spec = MetricSpec(
                    code=f"apib_{stem}_{program.lower()}_{slugify(subject)}",
                    name=f"{program} {subject} — {label}",
                    category=CATEGORY,
                    data_type="count",
                    unit="students",
                    description=f"Number of {program} {label} in {subject}.",
                    source=SOURCE,
                )
                spec_cache[key] = spec
            records.append(FactRecord(ecd, ename, spec, school_year, subgroup, float(val), None))
    return records
