#!/usr/bin/env python3
"""Check that every node's prerequisites precede it in jj history.

For each depends_on edge A -> B and each evaluates edge A -> B, the change
owning B must be older than the change owning A: prerequisites come before
their dependents, so history tells the dependency story and -A insertion
starts from the right place. Evaluations follow what they evaluate.

Usage: scripts/check-topology.py [repo-root]

Exit 0 when clean, 1 when a violation or structural problem is found.
Relies on: nodes/ directory, one <change-id>.json per node (the filename
prefix-matches the owning jj change id), and a jj working copy.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


def history_positions(root: Path) -> dict[str, int]:
    """Map full change id -> history position (0 = newest)."""
    out = subprocess.run(
        ["jj", "log", "-r", "all()", "--no-graph", "-T", 'change_id ++ "\n"'],
        cwd=root, capture_output=True, text=True, check=True,
    ).stdout.split()
    return {cid: i for i, cid in enumerate(out)}


def lookup(pos: dict[str, int], prefix: str) -> int | None:
    """Resolve an id prefix (as node filenames use) to a history position."""
    if prefix in pos:
        return pos[prefix]
    matches = [cid for cid in pos if cid.startswith(prefix)]
    return pos[matches[0]] if len(matches) == 1 else None


def main() -> int:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
    nodes_dir = root / "nodes"
    if not nodes_dir.is_dir():
        print(f"no node directory at {nodes_dir}")
        return 1

    try:
        pos = history_positions(root)
    except (subprocess.CalledProcessError, FileNotFoundError) as exc:
        print(f"cannot read jj history: {exc}")
        return 1

    problems = []
    for path in sorted(nodes_dir.glob("*.json")):
        node = path.stem
        try:
            doc = json.loads(path.read_text())
        except json.JSONDecodeError as exc:
            problems.append(f"{node}: unreadable node file: {exc}")
            continue
        node_pos = lookup(pos, node)
        if node_pos is None:
            problems.append(f"{node}: no jj change matches the filename")
            continue
        for field in ("depends_on", "evaluates"):
            for target in doc.get(field, []):
                if target == "zzzzzzzz":
                    continue  # repo root convention, not a change
                target_pos = lookup(pos, target)
                if target_pos is None:
                    problems.append(f"{node}: {field} names {target}, no such change")
                    continue
                # 0 is newest: a prerequisite must have a LARGER position
                # (be older) than its dependent.
                if target_pos < node_pos:
                    problems.append(
                        f"{node} -> {target} ({field}): prerequisite is newer in "
                        f"history; restack with jj rebase -s {target} -B {node}"
                    )

    if problems:
        print(f"{len(problems)} problem(s):")
        for line in problems:
            print(f"  {line}")
        return 1
    print("topology clean: every prerequisite precedes its dependent")
    return 0


if __name__ == "__main__":
    sys.exit(main())
