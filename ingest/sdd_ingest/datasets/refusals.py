"""Grades 3-8 ELA / Math test refusals — an xlsx (not Access).

Each sheet (ELA, MATH) uses a two-row header: row 0 names the subgroup group
(ALL STUDENTS, ENGLISH LANGUAGE LEARNER, STUDENTS WITH DISABILITIES,
ECONOMICALLY DISADVANTAGED) spanning a (TOTAL_COUNT, %_REFUSED) column pair.
We forward-fill the group row, pair it with the measure row, and melt — subgroup
becomes a dimension, subject folds into the metric code.
"""

from __future__ import annotations

from typing import List

import pandas as pd

from ..model import FactRecord, MetricSpec
from ..subgroups import canon_subgroup
from ..values import parse_value

SOURCE = "NYSED Grades 3-8 ELA/Math Test Refusals"
CATEGORY = "Assessment Refusals"
_SHEETS = ["ELA", "MATH"]
_ID_HEADERS = {"INSTITUTION_ID", "ENTITY_CD", "ENTITY_NAME", "SUBJECT"}


def _metric(subject: str, header: str) -> MetricSpec:
    subj = subject.lower()
    if header == "%_REFUSED":
        return MetricSpec(f"refusals_{subj}_pct", f"Grades 3-8 {subject} — test refusal rate",
                          CATEGORY, "percent", "%",
                          f"Percent of students who refused the grades 3-8 {subject} test.", SOURCE)
    return MetricSpec(f"refusals_{subj}_tested_count", f"Grades 3-8 {subject} — students",
                      CATEGORY, "count", "students",
                      f"Number of students eligible for the grades 3-8 {subject} test.", SOURCE)


def build(path: str, school_year: str, dict_path: str | None = None) -> List[FactRecord]:
    records: List[FactRecord] = []
    xl = pd.ExcelFile(path)

    for sheet in _SHEETS:
        if sheet not in xl.sheet_names:
            continue
        df = xl.parse(sheet, header=None, dtype=str).fillna("")

        # Forward-fill the subgroup-group row; pair with the measure row.
        groups, last = [], ""
        for v in df.iloc[0]:
            v = str(v).strip()
            if v:
                last = v
            groups.append(last)
        headers = [str(v).strip() for v in df.iloc[1]]
        idx = {h: i for i, h in enumerate(headers)}
        ecd_i, ename_i = idx.get("ENTITY_CD"), idx.get("ENTITY_NAME")
        subj_i = idx.get("SUBJECT")
        if ecd_i is None:
            continue

        # Pre-resolve (measure metric, subgroup) for each measure column.
        measure_cols = [
            (j, canon_subgroup(groups[j]))
            for j, h in enumerate(headers)
            if h in ("TOTAL_COUNT", "%_REFUSED") and h not in _ID_HEADERS
        ]

        data = df.iloc[2:]
        for i in range(len(data)):
            ecd = str(data.iat[i, ecd_i]).strip()
            ename = str(data.iat[i, ename_i]).strip() if ename_i is not None else ""
            if not ecd:
                continue
            subject = str(data.iat[i, subj_i]).strip() if subj_i is not None else sheet
            subject = subject or sheet
            for j, subgroup in measure_cols:
                num, text, skip = parse_value(data.iat[i, j])
                if skip:
                    continue
                records.append(
                    FactRecord(ecd, ename, _metric(subject, headers[j]),
                               school_year, subgroup, num, text)
                )
    return records
