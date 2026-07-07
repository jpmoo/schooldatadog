"""Per-dataset ingestion modules.

Each module exposes:
    LABEL: str
    build(path: str, school_year: str) -> list[FactRecord]
"""
