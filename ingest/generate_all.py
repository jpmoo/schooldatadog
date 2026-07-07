#!/usr/bin/env python3
"""Regenerate every dataset's SQL artifact for every year in sampledata/.

For each year folder it locates each dataset's zip, extracts the Access/xlsx
file (and dictionary, where used) to a scratch dir, runs the ingest CLI to emit
`data-loads/<dataset>_<year>.sql`, and cleans up. Datasets absent in a year
(AP/IB and ELL in 2024-25) are skipped. Run from the ingest/ directory:

    ./.venv/bin/python generate_all.py
"""

from __future__ import annotations

import fnmatch
import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

INGEST = Path(__file__).resolve().parent
ROOT = INGEST.parent
SAMPLE = ROOT / "sampledata"
OUT = ROOT / "data-loads"
WORK = INGEST / "_work"

YEARS = [("2022-2023", "2022-23"), ("2023-2024", "2023-24"), ("2024-2025", "2024-25")]
ACCESS_EXTS = {".mdb", ".accdb"}
DICT_USERS = {"ell", "gradrate", "sdr"}  # datasets whose build() consumes --dict

# dataset -> (zip name globs, member glob, member exts, dict glob or None)
DATASETS = [
    ("enrollment", ["enrollment_*.zip", "ENROLLMENT_*.zip"], "ENROLL*", {".mdb"}, None),
    ("ell", ["ell_*.zip"], "*ELL*", {".accdb", ".mdb"}, "*Variable*.xlsx"),
    ("gradrate", ["gradrate.zip"], "*", {".mdb"}, "*ReadMe*.pdf"),
    ("pathways", ["pathways.zip"], "*", {".mdb"}, None),
    ("studed", ["STUDED*.zip"], "STUDED*", {".mdb"}, None),
    ("sdr", ["student-digital-resources.zip"], "*Digital Resources*", {".accdb", ".mdb"}, "*.xlsx"),
    ("apib_course", ["APIB*.zip"], "*Course*", {".mdb", ".accdb"}, None),
    ("apib_assessment", ["APIB*.zip"], "*Assessment*", {".mdb", ".accdb"}, None),
    ("src", ["SRC*.zip"], "SRC*", {".mdb"}, None),
]
# refusals ships as a bare xlsx in the year folder
REFUSALS_GLOB = "*efusals*.xlsx"


def find_zip(folder: Path, globs: list[str]) -> Path | None:
    for g in globs:
        hits = sorted(folder.glob(g))
        if hits:
            return hits[0]
    return None


def pick_member(names: list[str], pattern: str, exts: set[str] | None) -> str | None:
    cands = []
    for n in names:
        base = os.path.basename(n)
        if not fnmatch.fnmatch(base.lower(), pattern.lower()):
            continue
        ext = os.path.splitext(base)[1].lower()
        if exts and ext not in exts:
            continue
        cands.append(n)
    # Prefer .mdb (best mdbtools support), then shorter names.
    cands.sort(key=lambda n: (0 if n.lower().endswith(".mdb") else 1, len(n)))
    return cands[0] if cands else None


def pick_dict(names: list[str], pattern: str) -> str | None:
    hits = [n for n in names if fnmatch.fnmatch(os.path.basename(n).lower(), pattern.lower())]
    # avoid the generic "How to Open an Access File" helper pdf
    hits = [n for n in hits if "how to" not in n.lower()]
    hits.sort(key=len)
    return hits[0] if hits else None


def extract(zpath: Path, member: str) -> Path:
    with zipfile.ZipFile(zpath) as z:
        z.extract(member, WORK)
    return WORK / member


def run_cli(dataset: str, path: Path, year: str, dict_path: Path | None) -> bool:
    target = OUT / f"{dataset}_{year}.sql"
    cmd = [sys.executable, "-m", "sdd_ingest.cli", dataset, str(path),
           "--year", year, "--emit-sql", str(target)]
    if dict_path and dataset in DICT_USERS:
        cmd += ["--dict", str(dict_path)]
    print(f"  → {dataset} {year}", flush=True)
    r = subprocess.run(cmd, cwd=INGEST, capture_output=True, text=True)
    for line in r.stdout.splitlines():
        if line.startswith(("[", "Wrote")):
            print("     " + line, flush=True)
    if r.returncode != 0:
        print("     FAILED:\n" + "\n".join("       " + l for l in r.stderr.splitlines()[-6:]), flush=True)
    return r.returncode == 0


def main() -> int:
    OUT.mkdir(exist_ok=True)
    ok = fail = 0
    for folder_name, year in YEARS:
        folder = SAMPLE / folder_name
        if not folder.is_dir():
            print(f"(skip {folder_name}: not found)")
            continue
        print(f"\n===== {folder_name}  ({year}) =====", flush=True)

        for dataset, zip_globs, member_glob, exts, dict_glob in DATASETS:
            zpath = find_zip(folder, zip_globs)
            if not zpath:
                continue  # dataset not present this year
            if WORK.exists():
                shutil.rmtree(WORK)
            WORK.mkdir(parents=True)
            try:
                with zipfile.ZipFile(zpath) as z:
                    names = z.namelist()
                member = pick_member(names, member_glob, exts)
                if not member:
                    print(f"  (skip {dataset}: no member in {zpath.name})")
                    continue
                data_path = extract(zpath, member)
                dict_path = None
                if dict_glob:
                    dm = pick_dict(names, dict_glob)
                    if dm:
                        dict_path = extract(zpath, dm)
                ok += 1 if run_cli(dataset, data_path, year, dict_path) else 0
                fail += 0 if (OUT / f"{dataset}_{year}.sql").exists() else 1
            finally:
                if WORK.exists():
                    shutil.rmtree(WORK)

        # refusals — bare xlsx in the folder (filename case varies by year)
        ref = sorted(p for p in folder.glob("*.xlsx") if "refusal" in p.name.lower())
        if ref:
            ok += 1 if run_cli("refusals", ref[0], year, None) else 0

    print(f"\nDone. Generated artifacts in {OUT}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
