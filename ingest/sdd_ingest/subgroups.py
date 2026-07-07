"""Canonical subgroup labels + normalization.

NYSED encodes demographic subgroups as column suffixes (NUM_BLACK, PER_SWD…) or
as values in a SUBGROUP field, with inconsistent spelling across datasets. We
normalize them to a single canonical label so the same subgroup lines up across
enrollment, graduation, assessment, etc.
"""

from __future__ import annotations

ALL_STUDENTS = "All Students"

# Raw token (uppercased) -> canonical label.
_SUBGROUP_MAP = {
    "ALL": ALL_STUDENTS,
    "ALL_STUDENTS": ALL_STUDENTS,
    # Gender
    "MALE": "Male",
    "FEMALE": "Female",
    "NONBINARY": "Non-Binary",
    "NON_BINARY": "Non-Binary",
    # Race / ethnicity
    "AM_IND": "American Indian or Alaska Native",
    "AMIND": "American Indian or Alaska Native",
    "BLACK": "Black or African American",
    "HISP": "Hispanic or Latino",
    "HISPANIC": "Hispanic or Latino",
    "ASIAN": "Asian or Native Hawaiian/Other Pacific Islander",
    "WHITE": "White",
    "MULTI": "Multiracial",
    "MULTIRACIAL": "Multiracial",
    # Status groups
    "SWD": "Students with Disabilities",
    "STUDENTS_WITH_DISABILITIES": "Students with Disabilities",
    "ECDIS": "Economically Disadvantaged",
    "ECONOMICALLY_DISADVANTAGED": "Economically Disadvantaged",
    "ECON": "Economically Disadvantaged",
    "ELL": "English Language Learners",
    "MLL": "English Language Learners",
    "ENGLISH_LANGUAGE_LEARNER": "English Language Learners",
    "NON_ENGLISH_LANGUAGE_LEARNER": "Not English Language Learners",
    "GENERAL_ED": "General Education Students",
    "NOT_SWD": "Students without Disabilities",
    "FORMER_ELL": "Former English Language Learners",
    "MIGRANT": "Migrant",
    "HOMELESS": "Homeless",
    "FOSTER": "In Foster Care",
    "PARENT_ARMED": "Parent in Armed Forces",
}


def canon_subgroup(token: str) -> str:
    """Normalize a raw subgroup token to its canonical label."""
    if token is None:
        return ALL_STUDENTS
    key = str(token).strip().upper().replace(" ", "_")
    return _SUBGROUP_MAP.get(key, str(token).strip())


# The single-dimension subgroups used across the app. Some datasets (AP/IB)
# pre-cross gender × ethnicity × status into hundreds of combined labels; we
# restrict those to this set so subgroups stay consistent and comparable.
STANDARD_SUBGROUPS = {
    ALL_STUDENTS,
    "Male", "Female", "Non-Binary",
    "American Indian or Alaska Native", "Black or African American",
    "Hispanic or Latino", "Asian or Native Hawaiian/Other Pacific Islander",
    "White", "Multiracial",
    "Students with Disabilities", "Students without Disabilities",
    "General Education Students",
    "Economically Disadvantaged", "Not Economically Disadvantaged",
    "English Language Learners", "Not English Language Learners",
    "Former English Language Learners",
    "Migrant", "Homeless", "In Foster Care",
}


def is_standard_subgroup(label: str) -> bool:
    return label in STANDARD_SUBGROUPS
