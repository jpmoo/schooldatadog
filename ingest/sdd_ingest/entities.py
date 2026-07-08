"""Inferring entity type + district rollup from the 12-digit BEDS code.

NY BEDS codes are 12 digits. District-level rows end in "0000"; specific
buildings carry a non-zero building portion. Statewide / regional aggregates
(NYC Public Schools, Large Cities, county rollups) use synthetic codes that
start with many zeros. These rules are heuristic and easy to refine once we see
the full code space in the School Report Card data.
"""

from __future__ import annotations

from typing import Optional


def infer_entity_type(entity_cd: Optional[str], entity_name: Optional[str] = None) -> str:
    """Return "school", "district", or "state" (used for aggregates too)."""
    cd = (entity_cd or "").strip()
    if not cd or set(cd) <= {"0"}:
        return "state"
    # Synthetic statewide / regional aggregate codes start with 8+ zeros.
    if cd[:8] == "00000000":
        return "state"
    # County rollups appear in two NYSED encodings, both whole-county aggregates
    # (never a real district — county is a filter dimension in the app):
    #   "NN0000000000" — county prefix then all zeros (e.g. "580000000000")
    #   "0000NN000000" — county-summary form (e.g. "000001000000" = "ALBANY County")
    if len(cd) == 12 and (
        cd[2:] == "0" * 10 or (cd[:4] == "0000" and cd[6:] == "0" * 6)
    ):
        return "state"
    if len(cd) == 12 and cd.endswith("0000"):
        return "district"
    return "school"


def parent_district_cd(entity_cd: Optional[str]) -> Optional[str]:
    """The BEDS code of a school's parent district, or None.

    A building shares its first 8 digits with its district; the district code
    zeroes the 4-digit building portion.
    """
    cd = (entity_cd or "").strip()
    if len(cd) != 12 or cd[:8] == "00000000":
        return None
    if cd.endswith("0000"):
        return None  # already a district
    return cd[:8] + "0000"
