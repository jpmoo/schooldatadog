"""Parse NYSED data dictionaries into {COLUMN_NAME: description}.

Each dataset ships a readme/variable guide (xlsx, PDF, or doc) describing its
columns. We parse those here at emit time (on the dev machine) so real
descriptions get baked into the `metrics` rows of the SQL artifact — the server
never needs the dictionary files.

Two shapes are handled:
  * xlsx variable tables (ELL, SDR): a header row with a name column and one or
    more description columns.
  * PDF "Name | Description | Type | Size" field tables (enrollment, gradrate):
    messy multi-column extraction with wrapped continuation rows.
"""

from __future__ import annotations

import re
from typing import Dict, List

import pandas as pd


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", str(text)).strip().strip("*").strip()


def from_xlsx(
    path: str,
    sheet: str,
    name_label: str,
    desc_labels: List[str],
) -> Dict[str, str]:
    """Map name-column -> joined description-column(s), found by header label."""
    xl = pd.ExcelFile(path)
    if sheet not in xl.sheet_names:
        return {}  # dictionary layout varies by year; fall back to synthesis
    df = xl.parse(sheet, header=None, dtype=str).fillna("")
    name_col = None
    desc_cols: List[int] = []
    header_row = None

    for i in range(min(15, len(df))):
        cells = [str(c).strip().lower() for c in df.iloc[i]]
        if name_label.lower() in cells and any(d.lower() in cells for d in desc_labels):
            header_row = i
            name_col = cells.index(name_label.lower())
            desc_cols = [cells.index(d.lower()) for d in desc_labels if d.lower() in cells]
            break
    if header_row is None:
        return {}

    out: Dict[str, str] = {}
    for i in range(header_row + 1, len(df)):
        row = [str(c).strip() for c in df.iloc[i]]
        name = row[name_col] if name_col < len(row) else ""
        if not name:
            continue
        parts = [row[c] for c in desc_cols if c < len(row) and row[c].strip()]
        desc = _clean(" — ".join(parts))
        if desc:
            out[name.upper()] = desc
    return out


# A variable name cell: ALL_CAPS / digits / underscores, optional footnote *.
_NAME_RE = re.compile(r"^[A-Z0-9_]{2,}\*?$")
# Standalone Type-column values to drop from descriptions.
_TYPE_WORDS = {
    "number", "text", "date", "numeric", "memo", "double", "integer",
    "currency", "boolean", "yes/no", "datetime", "float", "varchar",
}


def _is_type_or_size(cell: str) -> bool:
    c = cell.strip().lower()
    return c in _TYPE_WORDS or c.replace("*", "").isdigit()


def from_pdf_fields(path: str) -> Dict[str, str]:
    """Parse 'Name … Description … Type/Size' field tables across a PDF.

    Column indices drift row-to-row in these PDFs, so we anchor on content:
    a cell matching an ALL_CAPS name pattern starts a new variable, everything
    else on the row (minus Type/Size tokens) is description, and rows with no
    name continue the previous variable's wrapped description.
    """
    import pdfplumber

    out: Dict[str, str] = {}
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables():
                if not table or not table[0]:
                    continue
                header = " ".join((c or "").strip().lower() for c in table[0])
                if "name" not in header or "description" not in header:
                    continue

                last_name = None
                for row in table[1:]:
                    cells = [(c or "").strip() for c in row if (c or "").strip()]
                    if not cells:
                        continue
                    if _NAME_RE.match(cells[0]):
                        last_name = cells[0].rstrip("*").upper()
                        rest = [c for c in cells[1:] if not _is_type_or_size(c)]
                        desc = _clean(" ".join(rest))
                        if desc:
                            out[last_name] = desc
                        else:
                            out.setdefault(last_name, "")
                    elif last_name is not None:
                        rest = [c for c in cells if not _is_type_or_size(c)]
                        add = _clean(" ".join(rest))
                        if add:
                            out[last_name] = _clean(f"{out.get(last_name, '')} {add}")
    return {k: v for k, v in out.items() if v}
