#!/usr/bin/env python3
"""Register or remove the deccy guard as a PreToolUse hook in a Claude Code settings file.

Usage:
  settings-hook.py install   <settings.json> <guard.py>
  settings-hook.py uninstall <settings.json>
  settings-hook.py status    <settings.json>

link.sh calls this. The entry is recognised by the marker comment at the end of its command, so
install is idempotent (it replaces any earlier deccy entry, e.g. from another checkout) and
uninstall removes only ours. Every other key and hook in the file is left as it was. A settings file
that is not valid JSON is refused, never overwritten.

The hook runs in every session that loads the file, so its command fails open when the guard or
python3 is missing — a deleted bundle must not block every tool call on the machine. The guard
itself only acts on the five deccy agent types.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile

MARKER = "# deccy-agent-guard"
MATCHER = "Bash|Edit|Write|MultiEdit|NotebookEdit|Agent|Task|Skill"


def hook_command(guard: str) -> str:
    if "'" in guard:
        raise SystemExit(f"guard path may not contain a single quote: {guard}")
    return (f"[ -f '{guard}' ] && command -v python3 >/dev/null 2>&1 || exit 0; "
            f"python3 '{guard}' || exit 2 {MARKER}")


def is_ours(hook: object) -> bool:
    return isinstance(hook, dict) and MARKER in str(hook.get("command", ""))


def load(path: str) -> dict:
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as f:
        text = f.read()
    if not text.strip():
        return {}
    try:
        data = json.loads(text)
    except ValueError as e:
        raise SystemExit(f"refusing to edit {path}: not valid JSON ({e})")
    if not isinstance(data, dict):
        raise SystemExit(f"refusing to edit {path}: top level is not an object")
    return data


def save(path: str, data: dict) -> None:
    target = os.path.realpath(path)  # write through a dotfiles symlink, do not replace it
    os.makedirs(os.path.dirname(target), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(target), prefix=".settings-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
            f.write("\n")
        if os.path.exists(target):
            os.chmod(tmp, os.stat(target).st_mode & 0o777)
        os.replace(tmp, target)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def strip_ours(data: dict) -> bool:
    """Remove our hook entries in place; return True if anything was removed."""
    hooks = data.get("hooks")
    if not isinstance(hooks, dict) or not isinstance(hooks.get("PreToolUse"), list):
        return False
    removed = False
    groups = []
    for group in hooks["PreToolUse"]:
        if isinstance(group, dict) and isinstance(group.get("hooks"), list):
            kept = [h for h in group["hooks"] if not is_ours(h)]
            if len(kept) != len(group["hooks"]):
                removed = True
                if not kept:
                    continue  # the group held only our hook
                group = {**group, "hooks": kept}
        groups.append(group)
    if removed:
        if groups:
            hooks["PreToolUse"] = groups
        else:
            del hooks["PreToolUse"]
            if not hooks:
                del data["hooks"]
    return removed


def install(path: str, guard: str) -> str:
    data = load(path)
    strip_ours(data)
    hooks = data.setdefault("hooks", {})
    if not isinstance(hooks, dict):
        raise SystemExit(f"refusing to edit {path}: `hooks` is not an object")
    pre = hooks.setdefault("PreToolUse", [])
    if not isinstance(pre, list):
        raise SystemExit(f"refusing to edit {path}: `hooks.PreToolUse` is not a list")
    pre.append({"matcher": MATCHER, "hooks": [{"type": "command", "command": hook_command(guard)}]})
    save(path, data)
    return f"registered deccy guard in {path} -> {guard}"


def uninstall(path: str) -> str | None:
    if not os.path.exists(path):
        return None
    data = load(path)
    if not strip_ours(data):
        return None
    save(path, data)
    return f"removed deccy guard from {path}"


def status(path: str) -> str:
    data = load(path) if os.path.exists(path) else {}
    for group in (data.get("hooks") or {}).get("PreToolUse") or []:
        for h in (group.get("hooks") if isinstance(group, dict) else None) or []:
            if is_ours(h):
                return f"{path}: deccy guard registered: {h['command']}"
    return f"{path}: deccy guard not registered"


def main(argv: list[str]) -> int:
    if len(argv) >= 3 and argv[0] == "install":
        print(install(argv[1], argv[2]))
    elif len(argv) >= 2 and argv[0] == "uninstall":
        msg = uninstall(argv[1])
        if msg:
            print(msg)
    elif len(argv) >= 2 and argv[0] == "status":
        print(status(argv[1]))
    else:
        print(__doc__.split("\n\n")[1], file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
