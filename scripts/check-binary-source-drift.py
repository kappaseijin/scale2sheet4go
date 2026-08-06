#!/usr/bin/env python3
"""Check CLI command-set drift; this does not prove artifact provenance."""

import re
import hashlib
import subprocess
import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) != 3:
        print(f"usage: {sys.argv[0]} <binary> <source-cli>", file=sys.stderr)
        return 2
    binary, source_path = sys.argv[1:]
    source_file = Path(source_path).resolve()
    source = source_file.read_text(encoding="utf-8")
    expected = set(re.findall(r'\.command\(\s*["\']([^"\']+)["\']', source))
    result = subprocess.run([binary, "--help"], text=True, capture_output=True)
    if result.returncode != 0:
        print(f"binary --help failed with exit {result.returncode}", file=sys.stderr)
        return 1
    actual = set(re.findall(r"^  ([a-z][a-z0-9-]*)(?:\s+\[[^\]]+\])?\s{2,}", result.stdout, re.MULTILINE))
    binary_sha256 = hashlib.sha256(Path(binary).read_bytes()).hexdigest()
    source_root = subprocess.run(
        ["git", "-C", str(source_file.parent), "rev-parse", "--show-toplevel"],
        check=True, text=True, capture_output=True,
    ).stdout.strip()
    source_head = subprocess.run(
        ["git", "-C", source_root, "rev-parse", "HEAD"],
        check=True, text=True, capture_output=True,
    ).stdout.strip()
    missing = sorted(expected - actual)
    extra = sorted(actual - expected - {"help"})
    if missing or extra:
        print(f"FAIL: binary_sha256={binary_sha256} source_head={source_head} missing={missing} extra={extra}", file=sys.stderr)
        return 1
    print(f"PASS: binary_sha256={binary_sha256} source_head={source_head} command-set matches commands={sorted(expected)} (provenance not verified)")
    return 0


raise SystemExit(main())
