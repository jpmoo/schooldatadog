"""Reading Microsoft Access tables via mdbtools.

Requires the `mdbtools` CLI (>= 1.0 for .accdb support):
    macOS:  brew install mdbtools
    Debian: apt-get install mdbtools

Everything is read as strings so 12-digit BEDS codes keep their leading zeros;
callers coerce individual value columns to numbers via `values.parse_value`.
"""

from __future__ import annotations

import io
import subprocess
from pathlib import Path
from typing import List, Optional

import pandas as pd


def _run(args: List[str]) -> str:
    proc = subprocess.run(args, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(
            f"mdbtools command failed ({' '.join(args[:1])}): {proc.stderr.strip()}"
        )
    return proc.stdout


def list_tables(path: str | Path) -> List[str]:
    """User tables in the Access file (excludes temp/system tables)."""
    out = _run(["mdb-tables", "-1", str(path)])
    return [t for t in (line.strip() for line in out.splitlines()) if t and not t.startswith("~")]


def find_table(path: str | Path, contains: str) -> Optional[str]:
    """First table whose name contains `contains` (case-insensitive).

    Handy because some table names embed the year, e.g. "2022-23 ELL Enrollment".
    """
    needle = contains.lower()
    for name in list_tables(path):
        if needle in name.lower():
            return name
    return None


def read_table(path: str | Path, table: str) -> pd.DataFrame:
    """Read an Access table into a DataFrame with all columns as strings.

    Column names are upper-cased because NYSED changed the casing of many
    columns between years (aggregation_code -> AGGREGATION_CODE, etc.); datasets
    reference the upper-cased names so the same code works across all years.
    """
    csv = _run(["mdb-export", str(path), table])
    df = pd.read_csv(
        io.StringIO(csv),
        dtype=str,
        keep_default_na=False,  # keep "" and "NA" as literal strings
        na_filter=False,
    )
    df.columns = [str(c).strip().upper() for c in df.columns]
    return df
