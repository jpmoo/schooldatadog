"""School Data Dog — NYSED Access-database ingestion toolkit.

Reads the yearly NYSED datasets (School Report Card, enrollment, ELL, graduation
rate, pathways, AP/IB, student/educator, digital resources) out of Microsoft
Access files via ``mdbtools``, melts the wide tables into long
(entity, metric, school_year, subgroup, value) facts, and upserts them into the
same Postgres database the web app uses.

Run with ``python -m sdd_ingest.cli <dataset> <path> --year 2022-23``.
"""

__all__ = ["__version__"]
__version__ = "0.1.0"
