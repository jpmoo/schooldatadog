"""Core data structures shared across the ingestion pipeline."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

# Allowed values mirror the `data_type` enum in the Drizzle schema.
DataType = str  # "numeric" | "percent" | "count" | "currency" | "ratio" | "categorical" | "text"


@dataclass(frozen=True)
class MetricSpec:
    """A datapoint definition — one row in the `metrics` (data dictionary) table.

    `code` is the stable machine key (e.g. "enroll_grade_3"); re-ingesting the
    same dataset upserts by this key rather than duplicating.
    """

    code: str
    name: str
    category: str
    data_type: DataType = "numeric"
    unit: Optional[str] = None
    description: Optional[str] = None
    source: Optional[str] = None


@dataclass
class FactRecord:
    """A single observation destined for the `facts` table."""

    entity_cd: str
    entity_name: str
    metric: MetricSpec
    school_year: str
    subgroup: str
    value_numeric: Optional[float]
    value_text: Optional[str]
