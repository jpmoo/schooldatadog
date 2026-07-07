"""Fallback metric descriptions.

Every metric should carry a description (for tooltips and semantic search). Where
a data dictionary supplied one, we keep it. Otherwise we synthesize a reasonable
one from the metric's own (already descriptive) name, its measure type, and its
category — surmised, but deterministic and repeatable.
"""

from __future__ import annotations

from .model import MetricSpec

_TYPE_PHRASE = {
    "percent": "Reported as a percentage.",
    "count": "Reported as a count.",
    "currency": "Reported as a dollar amount.",
    "ratio": "Reported as a ratio.",
    "numeric": "A numeric measure.",
    "categorical": "A category/label value.",
    "text": "A text value.",
}


def synthesize(m: MetricSpec) -> str:
    name = m.name.strip().rstrip(".")
    parts = [f"{name}."]
    parts.append(_TYPE_PHRASE.get(m.data_type, "A measure."))
    if m.category:
        parts.append(f"Part of the {m.category} data.")
    return " ".join(parts)


def describe(m: MetricSpec) -> str:
    """The metric's description, or a synthesized fallback if it has none."""
    return m.description if (m.description and m.description.strip()) else synthesize(m)
