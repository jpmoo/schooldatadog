"""Environment / path configuration."""

from __future__ import annotations

import os
from pathlib import Path

# ingest/sdd_ingest/config.py -> project root is two parents up.
PROJECT_ROOT = Path(__file__).resolve().parents[2]
INGEST_ROOT = Path(__file__).resolve().parents[1]
SAMPLE_DATA = PROJECT_ROOT / "sampledata"

# Load DATABASE_URL from a .env if python-dotenv is available. We check the
# project root first (shared with the web app), then the ingest/ folder.
try:
    from dotenv import load_dotenv

    for candidate in (PROJECT_ROOT / ".env", INGEST_ROOT / ".env"):
        if candidate.exists():
            load_dotenv(candidate)
except ImportError:  # dotenv is optional; env vars may be set directly.
    pass

DATABASE_URL = os.environ.get("DATABASE_URL")
