"""Parsing NYSED cell values.

NYSED uses a handful of non-numeric markers for missing / suppressed data
("s" = suppressed for small-n privacy, "-" = not applicable, "*", "N/A", ".").
We keep those as a text marker (so the fact still exists and the UI can show
"suppressed") but leave the numeric value null.
"""

from __future__ import annotations

import re
from typing import Optional, Tuple

_SUPPRESSED = {"s", "-", "*", "n/a", "na", ".", "#", "‡", "--"}


def parse_value(raw) -> Tuple[Optional[float], Optional[str], bool]:
    """Parse a raw cell.

    Returns (value_numeric, value_text, skip):
      - skip=True  -> blank/missing; no fact should be emitted.
      - a numeric  -> (float, None, False)
      - a marker   -> (None, marker, False)   e.g. suppressed "s"
      - other text -> (None, text, False)     categorical values
    """
    if raw is None:
        return (None, None, True)

    s = str(raw).strip()
    if s == "" or s.lower() == "nan":
        return (None, None, True)

    if s.lower() in _SUPPRESSED:
        return (None, s, False)

    cleaned = s.replace(",", "").replace("%", "").replace("$", "").strip()
    try:
        return (float(cleaned), None, False)
    except ValueError:
        return (None, s, False)


def school_year_from_fall(raw) -> Optional[str]:
    """NYSED 'YEAR' is the fall year of a school year; 2022 -> '2022-23'."""
    try:
        y = int(float(str(raw).strip()))
    except (ValueError, TypeError):
        return None
    if y < 1990 or y > 2100:
        return None
    return f"{y}-{str(y + 1)[-2:]}"


def school_year_from_ending(raw) -> Optional[str]:
    """NYSED report-card 'YEAR' is the ending year; 2023 -> '2022-23'.

    Used by assessment/Regents (spring year) and spending/absenteeism (fiscal
    year) tables, which all label a school year by the calendar year it ends.
    """
    try:
        y = int(float(str(raw).strip()))
    except (ValueError, TypeError):
        return None
    if y < 1990 or y > 2100:
        return None
    return f"{y - 1}-{str(y)[-2:]}"


def school_year_flexible(raw) -> Optional[str]:
    """Accept a school year in either form NYSED uses: an already-formatted
    '2024-25' label, or a '06/30/25' end-of-year date stamp."""
    s = str(raw).strip()
    if re.fullmatch(r"\d{4}-\d{2}", s):
        return s
    return school_year_from_date(raw)


def school_year_from_date(raw) -> Optional[str]:
    """A '06/30/23' end-of-year date -> the school year it closes, '2022-23'.

    NYSED report-card date stamps use the June 30 that ends the school year, so
    the school year is (end_year - 1)-(end_year).
    """
    s = str(raw).strip()
    if not s:
        return None
    # Grab the year from an MM/DD/YY[YY] stamp (optionally with a time).
    parts = s.split()[0].split("/")
    if len(parts) != 3:
        return None
    yy = parts[2]
    try:
        end = int(yy)
    except ValueError:
        return None
    if end < 100:
        end += 2000
    start = end - 1
    return f"{start}-{str(end)[-2:]}"
