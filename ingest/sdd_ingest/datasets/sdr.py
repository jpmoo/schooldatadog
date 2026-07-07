"""Student Digital Resources (digital equity survey).

Row-based by subgroup. The entity is the 12-digit STATE_LOCATION_ID (no name
column — entities keep the names supplied by other datasets). The ~90 measure
columns (IAT_*, PD_*, IAB_*… counts and percents) are auto-registered as
metrics, since the column codes are the datapoints; the SDR variable guide can
enrich the descriptions later.
"""

from __future__ import annotations

from typing import Dict, List

from .. import dictionaries as D
from ..mdb import find_table, read_table
from ..melt import melt_rows
from ..model import FactRecord, MetricSpec
from ..values import school_year_flexible

SOURCE = "NYSED Student Digital Resources"
CATEGORY = "Student Digital Resources"

# Non-measure columns (keys / dimensions), excluded from the melted metrics.
_ID_COLS = {
    "SCHOOL_YEAR", "STATE_DISTRICT_ID", "LEA_INSTITUTION_ID", "STATE_LOCATION_ID",
    "SCHOOL_INSTITUTION_ID", "SUBGROUP_CODE", "SUBGROUP_NAME", "SORT_SEQ",
}


def _pretty(col: str) -> str:
    return "Digital Resources — " + col.replace("_", " ").title()


def _specs(df, descs: Dict[str, str]) -> Dict[str, MetricSpec]:
    specs: Dict[str, MetricSpec] = {}
    for col in df.columns:
        if col.upper() in _ID_COLS:
            continue
        is_pct = col.upper().endswith("_PCT")
        specs[col] = MetricSpec(
            code="sdr_" + col.lower(),
            name=_pretty(col),
            category=CATEGORY,
            data_type="percent" if is_pct else "count",
            unit="%" if is_pct else None,
            description=descs.get(col.upper()),
            source=SOURCE,
        )
    return specs


def build(path: str, school_year: str, dict_path: str | None = None) -> List[FactRecord]:
    table = find_table(path, "DIGITAL")
    if table is None:
        raise RuntimeError(f"No digital-resources table found in {path}")
    df = read_table(path, table)
    descs = D.from_xlsx(dict_path, "Key", "HEADER", ["FIELD", "QUESTION"]) if dict_path else {}
    return melt_rows(
        df,
        entity_cd_col="STATE_LOCATION_ID",
        entity_name_col="LOCATION_NAME",  # absent in older years; melt tolerates it
        value_specs=_specs(df, descs),
        school_year_col="SCHOOL_YEAR",
        year_transform=school_year_flexible,
        subgroup_col="SUBGROUP_NAME",
    )
