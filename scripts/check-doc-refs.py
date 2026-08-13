#!/usr/bin/env python3
"""Validate documented repository-relative file and line references."""
from __future__ import annotations

from pathlib import Path
import re


# This path belongs to the agmsg repository, not scale2sheet.  It is retained
# as an implementation precedent in a decision document, so it is excluded
# instead of making the repository-relative check fail permanently.
EXTERNAL_PATH_REFERENCES = {"scripts/lib/storage.sh"}

# Decision documents are historical records.  Their line references point to
# the document layout that existed when the decision was made; current design
# documents may be rewritten by a later implementation issue.  Keep the
# historical text immutable and validate line references in current-facing
# documents instead.
HISTORICAL_DOCUMENTS = {
    "docs/decisions/2026-08-04T151338_pipeline入力段階の失敗と部分成功の目標定義.md",
    "docs/decisions/2026-08-04T170446_数え方の版についての目標定義.md",
}


def find_invalid_line_references(root: Path) -> list[str]:
    """Check only reference existence and line bounds, not semantic content."""
    reference = re.compile(
        r"`([A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)+):"
        r"(\d+)(?:-(\d+))?`"
    )
    errors: list[str] = []
    documents = [root / "README.md", *sorted((root / "docs").rglob("*.md"))]
    for document in documents:
        if document.relative_to(root).as_posix() in HISTORICAL_DOCUMENTS:
            continue
        text = document.read_text()
        for match in reference.finditer(text):
            path_text, start_text, end_text = match.groups()
            if path_text in EXTERNAL_PATH_REFERENCES:
                continue
            target = root / path_text
            start, end = int(start_text), int(end_text or start_text)
            location = f"{document.relative_to(root)}:{text[:match.start()].count(chr(10)) + 1}"
            if not target.is_file():
                errors.append(f"{location}: referenced file does not exist: {path_text}")
                continue
            line_count = len(target.read_text().splitlines())
            if start < 1 or end < start or end > line_count:
                errors.append(
                    f"{location}: referenced lines {start}-{end} exceed "
                    f"{path_text} line count {line_count}"
                )
    return errors


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1]
    errors = find_invalid_line_references(root)
    if errors:
        raise SystemExit("Document reference validation failed:\n" + "\n".join(errors))
    print("document path:line references are valid")
