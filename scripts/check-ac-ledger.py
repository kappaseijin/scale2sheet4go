#!/usr/bin/env python3
"""Parse the AC reservation ledger; validation is added in later steps."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re
import shutil
import subprocess


@dataclass(frozen=True)
class Reservation:
    start: int
    end: int
    issue: str
    planned_count: int
    reserved_count: int
    defined_count: int
    state: str
    definition_document: str


# AC-54a is a suffix-only legacy definition, not an integer range overlap.
LEGACY_OVERLAPS = {frozenset(("#56 G-3 追補", "#66")), frozenset(("#66", "#65"))}

def parse_reservations(ledger: str) -> list[Reservation]:
    reservations: list[Reservation] = []
    for line in ledger.splitlines():
        cells = [cell.strip() for cell in line.split("|")]
        if len(cells) < 11 or not re.fullmatch(r"AC-\d+", cells[1]) or not re.fullmatch(r"AC-\d+", cells[2]):
            continue
        if not (cells[3].startswith("#") or cells[3] == "なし"):
            continue
        reservations.append(Reservation(
            start=int(cells[1][3:]), end=int(cells[2][3:]), issue=cells[3],
            planned_count=int(cells[4]), reserved_count=int(cells[5]),
            defined_count=int(cells[6]), state=cells[7].strip("`"),
            definition_document=cells[9],
        ))
    return reservations


def find_unapproved_overlaps(rows: list[Reservation]) -> list[str]:
    errors: list[str] = []
    for index, left in enumerate(rows):
        for right in rows[index + 1:]:
            start, end = max(left.start, right.start), min(left.end, right.end)
            if start <= end and frozenset((left.issue, right.issue)) not in LEGACY_OVERLAPS:
                errors.append(f"AC-{start}..AC-{end}: {left.issue} overlaps {right.issue}")
    return errors


def find_unreserved_references(root: Path, rows: list[Reservation]) -> tuple[list[str], int]:
    minimum = min(row.start for row in rows)
    registered = {number for row in rows for number in range(row.start, row.end + 1)}
    errors: list[str] = []
    excluded = 0
    for path in (root / "docs").rglob("*.md"):
        if path.name == "ACCEPTANCE_TEST_REPORT.md":
            continue
        for match in re.finditer(r"\bAC-(\d+)(?![a-zA-Z0-9])", path.read_text()):
            number = int(match.group(1))
            if number < minimum:
                excluded += 1
            elif number not in registered:
                errors.append(f"unreserved AC-{number} in {path.relative_to(root)}")
    return errors, excluded


def find_definition_count_mismatches(rows: list[Reservation]) -> list[str]:
    return [f"AC-{r.start}..AC-{r.end}: planned {r.planned_count}, reserved {r.reserved_count}, range {r.end-r.start+1}"
            for r in rows if r.state != "UNUSED" and (r.start, r.end) != (53, 65) and (r.reserved_count != r.end-r.start+1 or r.planned_count != r.reserved_count)]


def find_actual_definition_mismatches(root: Path, rows: list[Reservation]) -> list[str]:
    errors = []
    for row in rows:
        match = re.search(r"\]\(([^)]+)\)", row.definition_document)
        if row.state == "CONFIRMED" and match:
            # Only list-item definitions count; prose references do not define an AC.
            # A definition is a list item whose bold lead starts with AC-N.  Prose
            # references do not start a list item; suffixes such as AC-54a are distinct.
            definitions = re.findall(r"^- \*\*AC-(\d+)([A-Za-z]*)", (root / "docs" / match.group(1)).read_text(), re.M)
            actual = len({f"{number}{suffix}" for number, suffix in definitions if row.start <= int(number) <= row.end})
            if actual != row.planned_count:
                errors.append(f"AC-{row.start}..AC-{row.end}: planned {row.planned_count}, actual {actual}")
    return errors


def classify_definition_statuses(root: Path, rows: list[Reservation]) -> dict[str, list[str]]:
    groups: dict[str, list[str]] = {}
    for row in rows:
        match = re.search(r"\]\(([^)]+)\)", row.definition_document)
        if row.state == "CONFIRMED" and match:
            target = root / "docs" / match.group(1)
            status = re.search(r"^status:\s*(\S+)\s*$", target.read_text(), re.M)
            groups.setdefault(status.group(1) if status else "missing", []).append(f"AC-{row.start}..AC-{row.end}: {target.relative_to(root)}")
    return groups


def find_non_main_commit_evidence(ledger: str, root: Path) -> list[str]:
    """Reject result-table commit evidence that cannot be reached from origin/main."""
    errors: list[str] = []
    if shutil.which("git") is None:
        print("skipping target-commit ancestry check: git is not available")
        return errors
    in_result_table = False
    for line in ledger.splitlines():
        cells = [cell.strip() for cell in line.split("|")]
        if "対象 commit" in cells:
            in_result_table = True
            continue
        if not in_result_table or len(cells) < 10 or not re.fullmatch(r"AC-\d+[A-Za-z]*", cells[1]):
            continue

        evidence = cells[5]
        if evidence == "—":
            continue
        for commit in (part.strip() for part in evidence.split(",")):
            if not re.fullmatch(r"[0-9a-f]{7,40}", commit):
                errors.append(f"{cells[1]}: target commit is not a SHA: {commit}")
                continue
            if subprocess.run(
                ["git", "-C", str(root), "merge-base", "--is-ancestor", commit, "origin/main"],
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            ).returncode != 0:
                errors.append(f"{cells[1]}: target commit is not an ancestor of origin/main: {commit}")
    return errors


def find_sha_execution_methods(ledger: str) -> list[str]:
    """Reject SHA-shaped values in the result table's execution-method column."""
    errors: list[str] = []
    in_result_table = False
    for line in ledger.splitlines():
        cells = [cell.strip() for cell in line.split("|")]
        if "対象 commit" in cells:
            in_result_table = True
            continue
        if not in_result_table or len(cells) < 10 or not re.fullmatch(r"AC-\d+[A-Za-z]*", cells[1]):
            continue
        method = cells[4]
        if re.fullmatch(r"[0-9a-fA-F]{7,40}", method):
            errors.append(f"{cells[1]}: execution method must be a command or —, not a SHA: {method}")
    return errors


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1]
    rows = parse_reservations((root / "docs/ACCEPTANCE_TEST_REPORT.md").read_text())
    errors = find_unapproved_overlaps(rows)
    missing, excluded = find_unreserved_references(root, rows)
    errors.extend(missing)
    errors.extend(find_definition_count_mismatches(rows))
    errors.extend(find_actual_definition_mismatches(root, rows))
    errors.extend(find_sha_execution_methods((root / "docs/ACCEPTANCE_TEST_REPORT.md").read_text()))
    errors.extend(find_non_main_commit_evidence((root / "docs/ACCEPTANCE_TEST_REPORT.md").read_text(), root))
    statuses = classify_definition_statuses(root, rows)
    if errors:
        raise SystemExit("AC ledger validation failed:\n" + "\n".join(errors))
    print(f"parsed {len(rows)} AC reservation rows; excluded {excluded} pre-ledger references")
    for status, entries in sorted(statuses.items()):
        print(f"CONFIRMED definition status {status} ({len(entries)}):\n" + "\n".join(entries))
