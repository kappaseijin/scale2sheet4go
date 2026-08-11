#!/usr/bin/env python3
"""Check CLI command-set drift; this does not prove artifact provenance."""

import re
import hashlib
import subprocess
import sys
from pathlib import Path

COMMAND_NAME_PATTERN = re.compile(r"^  ([a-z][a-z0-9-]*)", re.MULTILINE)


def command_names_from_help(help_text: str) -> set[str]:
    return set(COMMAND_NAME_PATTERN.findall(help_text)) - {"help"}


def main() -> int:
    if len(sys.argv) not in (3, 5) or (len(sys.argv) == 5 and sys.argv[3] != "--source-help-file"):
        print(f"usage: {sys.argv[0]} <binary> <source-entry> [--source-help-file <file>]", file=sys.stderr)
        return 2
    binary, source_path = sys.argv[1:3]
    source_help_file = Path(sys.argv[4]) if len(sys.argv) == 5 else None
    source_file = Path(source_path).resolve()

    # #128 follow-up: a previous version read src/cli/index.ts with a regex
    # to build `expected`. That missed commands registered by a helper
    # called from index.ts (registerInstallationCommands -> install/
    # uninstall), because the regex only ever looked at one file. Running
    # the SOURCE itself through tsx and parsing its own --help output uses
    # the exact same Commander wiring the compiled binary uses, so any
    # command registered anywhere the program actually reaches shows up --
    # no file-by-file regex to fall behind as more helpers are added.
    if source_help_file is None:
        source_result = subprocess.run(
            ["npx", "tsx", str(source_file), "--help"], text=True, capture_output=True
        )
        if source_result.returncode != 0:
            print(f"source --help failed with exit {source_result.returncode}: {source_result.stderr}", file=sys.stderr)
            return 1
        source_help = source_result.stdout
    else:
        try:
            source_help = source_help_file.read_text(encoding="utf-8")
        except OSError as error:
            print(f"source --help cache could not be read: {error}", file=sys.stderr)
            return 1
    expected = command_names_from_help(source_help)
    if not expected:
        print("FAIL: no commands parsed from source --help", file=sys.stderr)
        return 1

    result = subprocess.run([binary, "--help"], text=True, capture_output=True)
    if result.returncode != 0:
        print(f"binary --help failed with exit {result.returncode}", file=sys.stderr)
        return 1
    actual = command_names_from_help(result.stdout)
    if not actual:
        print("FAIL: no commands parsed from binary --help", file=sys.stderr)
        return 1

    binary_sha256 = hashlib.sha256(Path(binary).read_bytes()).hexdigest()
    source_head = "unknown"
    try:
        source_root = subprocess.run(
            ["git", "-C", str(source_file.parent), "rev-parse", "--show-toplevel"],
            check=True, text=True, capture_output=True,
        ).stdout.strip()
        head_sha = subprocess.run(
            ["git", "-C", source_root, "rev-parse", "HEAD"],
            check=True, text=True, capture_output=True,
        ).stdout.strip()
        dirty_check = subprocess.run(
            ["git", "-C", source_root, "status", "--porcelain"],
            check=True, text=True, capture_output=True,
        ).stdout
        source_head = head_sha + ("-dirty" if dirty_check.strip() else "")
    except subprocess.CalledProcessError:
        pass
    missing = sorted(expected - actual)
    extra = sorted(actual - expected)
    if missing or extra:
        print(f"FAIL: binary_sha256={binary_sha256} source_head={source_head} missing={missing} extra={extra}", file=sys.stderr)
        return 1
    print(f"PASS: binary_sha256={binary_sha256} source_head={source_head} command-set matches commands={sorted(expected)} (provenance not verified)")
    return 0


raise SystemExit(main())
