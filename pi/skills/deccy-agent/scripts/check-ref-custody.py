#!/usr/bin/env python3
"""Check content custody: no change touches another node's content.

A node's ref'd files and its nodes/<id>.json file carry that node's content
and nobody else's. For every change, the paths its diff touches must be free
or owned by that change's own node. A change with no node file may touch only
unowned paths. Two nodes ref'ing the same path is also a violation: custody
needs a single owner to be checkable.

Usage: scripts/check-ref-custody.py [repo-root]

Exit 0 when clean, 1 when a violation or structural problem is found.
Relies on: nodes/ directory, one <change-id>.json per node (the filename
prefix-matches the owning jj change id), and a jj working copy.
"""

from __future__ import annotations

import json
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

SUMMARY_SENTINEL = "==REC=="


def change_summaries(root: Path) -> dict[str, list[str]]:
    """Map full change id -> diff summary lines (e.g. "A nodes/x.json")."""
    out = subprocess.run(
        [
            "jj", "log", "-r", "all()", "--no-graph",
            "-T", f'change_id ++ "\\n" ++ diff.summary() ++ "{SUMMARY_SENTINEL}"',
        ],
        cwd=root, capture_output=True, text=True, check=True,
    ).stdout
    records: dict[str, list[str]] = {}
    for chunk in out.split(SUMMARY_SENTINEL):
        lines = chunk.splitlines()
        if not lines:
            continue
        records[lines[0].strip()] = [ln.strip() for ln in lines[1:] if ln.strip()]
    return records


def resolve(prefix: str, full_ids: list[str]) -> str | None:
    """Resolve a node filename stem (an id prefix) to a full change id."""
    if prefix in full_ids:
        return prefix
    matches = [cid for cid in full_ids if cid.startswith(prefix)]
    return matches[0] if len(matches) == 1 else None


def touched_paths(summary_lines: list[str]) -> list[str]:
    """Paths a diff summary reports as added, modified, deleted or renamed."""
    paths = []
    for line in summary_lines:
        parts = line.split(maxsplit=1)
        if len(parts) != 2:
            continue
        path = parts[1]
        if " => " in path:  # rename: both sides were touched
            paths.extend(p.strip("{} ") for p in path.split(" => "))
        else:
            paths.append(path.strip("{}"))
    return paths


def main() -> int:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
    nodes_dir = root / "nodes"
    if not nodes_dir.is_dir():
        print(f"no node directory at {nodes_dir}")
        return 1

    owners: dict[str, set[str]] = defaultdict(set)
    problems = []
    for path in sorted(nodes_dir.glob("*.json")):
        node = path.stem
        owners[f"nodes/{path.name}"].add(node)  # the node file: own content
        try:
            doc = json.loads(path.read_text())
        except json.JSONDecodeError as exc:
            problems.append(f"{node}: unreadable node file: {exc}")
            continue
        ref = doc.get("content", {}).get("ref", [])
        for p in ref if isinstance(ref, list) else []:
            owners[p].add(node)

    for path, nodes in sorted(owners.items()):
        if len(nodes) > 1:
            problems.append(
                f"{path}: ref'd by {', '.join(sorted(nodes))} — custody needs one owner"
            )

    try:
        summaries = change_summaries(root)
    except (subprocess.CalledProcessError, FileNotFoundError) as exc:
        print(f"cannot read jj history: {exc}")
        return 1

    full_ids = list(summaries)
    node_to_change = {}
    for path in sorted(nodes_dir.glob("*.json")):
        node = path.stem
        full = resolve(node, full_ids)
        if full is None:
            problems.append(f"{node}: no jj change matches the filename")
        else:
            node_to_change[full] = node

    for change_id, summary_lines in summaries.items():
        node = node_to_change.get(change_id)
        for p in touched_paths(summary_lines):
            holders = owners.get(p, set())
            if not holders or holders == {node}:
                continue  # unowned or own content: fine
            if node is None:
                problems.append(
                    f"{change_id[:8]} (no node file) touches {p}, "
                    f"owned by {', '.join(sorted(holders))}"
                )
            else:
                problems.append(
                    f"{node} touches {p}, owned by {', '.join(sorted(holders))}"
                )

    if problems:
        print(f"{len(problems)} problem(s):")
        for line in problems:
            print(f"  {line}")
        return 1
    print("custody clean: every change touches only its own node's content")
    return 0


if __name__ == "__main__":
    sys.exit(main())
