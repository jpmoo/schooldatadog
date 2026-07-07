"""Small NYSED-specific helpers shared across datasets."""

from __future__ import annotations

import re
from typing import Optional, Tuple


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(text).lower()).strip("_")


def grade_dimension(assessment_name: str):
    """'ELA6' / 'MATH8' -> (code_suffix, name_suffix) for the grade level."""
    m = re.search(r"(\d+)", str(assessment_name))
    if not m:
        return None
    g = m.group(1)
    return (f"_g{g}", f" — Grade {g}")


def label_dimension(label: str):
    """Fold an arbitrary label (subject, cohort class…) into the metric code."""
    s = str(label).strip()
    if not s:
        return None
    return (f"_{slugify(s)}", f" — {s}")


def cohort_dimension(desc: str) -> Optional[Tuple[str, str]]:
    """NYSED cohort `membership_desc` -> (code_suffix, name_suffix).

    Distinguishes 4/5/6-year outcomes and the June (default) vs August release.
    Returns None for anything unrecognized so the row is skipped.
    Shared by graduation rate and graduation/career pathways.
    """
    d = str(desc)
    if "4 Year" in d:
        length, label = "4yr", "4-year"
    elif "5 Year" in d:
        length, label = "5yr", "5-year"
    elif "6 Year" in d:
        length, label = "6yr", "6-year"
    else:
        return None
    if "August" in d:
        return (f"_{length}_aug", f" ({label} outcome, August)")
    return (f"_{length}", f" ({label} outcome, June)")
