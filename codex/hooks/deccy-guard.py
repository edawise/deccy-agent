#!/usr/bin/env python3
"""PreToolUse guard for the deccy Codex agents.

Codex has no per-agent permission manifest. A settings-level PreToolUse hook sees every tool call
in the root session and in its subagents, but the calling agent is identified only by `agent_type`
and `agent_id`. In Codex's V2 spawn surface every child reports `agent_type: "default"` and a unique
`agent_id`; the spawn tool does not accept a custom agent type. This guard therefore uses a small
role-routing handshake:

  parent:  spawn_agent(task_name="deccy_drafter_u1", fork_turns="none", ...)
           -> spawn pre-tool event carries the task name; the guard records a pending role
  child:   deccy-codex register deccy_drafter_u1
           -> the guard binds the child's agent_id to the pending role
  child:   every later tool call resolves its policy from agent_id

The root planner/orchestrator session resolves its role from `DECCY_ROLE`, which the launcher sets.
A session with no `DECCY_ROLE` and no deccy role is passed through untouched, so the hook is safe
to register globally.

The role policies mirror `opencode/agents/*.md` and the Claude port:

- skill allow lists                    -> Skill calls
- write path allow lists               -> apply_patch Add/Update/Delete/Move paths and Edit/Write
- shell deny/allow patterns            -> Bash commands, checked per sub-command
- agent/subagent allow lists           -> collaboration spawn and control tools

Shell patterns use OpenCode semantics: `*` matches anything, rules are evaluated in order and the
last matching rule wins; no match means allow. Compound commands are split, substitutions and
shell `-c` bodies are checked as commands, and wrappers and jj/git global options are stripped
before matching.

Exit 0 allows; exit 2 blocks with the reason on stderr. This is a guard, not a sandbox: a
determined shell can still write a file the patterns do not anticipate.
"""

from __future__ import annotations

import fnmatch
import json
import os
import re
import shlex
import sys

ROLES = ("deccy-plan", "deccy-orchestrator", "deccy-gate-author", "deccy-drafter", "deccy-judge")

# Spawn task-name prefix -> role. The orchestrator must use exactly these prefixes.
TASK_ROLES = (
    ("deccy_plan_", "deccy-plan"),
    ("deccy_gate_author_", "deccy-gate-author"),
    ("deccy_drafter_", "deccy-drafter"),
    ("deccy_judge_", "deccy-judge"),
)

TASK_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]*$")
SAFE_STATE = re.compile(r"[^A-Za-z0-9_.-]")
PATCH_FILE = re.compile(r"^\*\*\* (Add|Update|Delete) File:\s*(.+?)\s*$")
PATCH_MOVE = re.compile(r"^\*\*\* Move to:\s*(.+?)\s*$")


def agent_root() -> str:
    return os.environ.get("DECCY_GUARD_ROOT") or os.environ.get("DECCY_AGENT_ROOT") \
        or "~/.local/share/deccy/agent"


def state_root() -> str:
    return os.environ.get("DECCY_STATE") or os.path.join(agent_root(), "state")


def role_for_task(task_name: str) -> str | None:
    if not TASK_NAME.fullmatch(task_name or ""):
        return None
    for prefix, role in TASK_ROLES:
        if task_name.startswith(prefix) and len(task_name) > len(prefix):
            return role
    return None


def safe_name(value: str) -> str:
    value = SAFE_STATE.sub("_", value or "")
    if not value or value in (".", ".."):
        return ""
    return value


def role_file(event: dict) -> str:
    session = safe_name(event.get("session_id") or "")
    agent = safe_name(event.get("agent_id") or "")
    if not session or not agent:
        return ""
    return os.path.join(state_root(), session, "roles", agent)


def pending_file(session_id: str, task_name: str) -> str:
    session = safe_name(session_id)
    if not session or not TASK_NAME.fullmatch(task_name or ""):
        return ""
    return os.path.join(state_root(), session, "pending", task_name)


def read_role(event: dict) -> str | None:
    path = role_file(event)
    if not path:
        return None
    try:
        with open(path, encoding="utf-8") as f:
            role = f.read().strip()
    except OSError:
        return None
    return role if role in ROLES else None


def write_role(event: dict, role: str) -> bool:
    path = role_file(event)
    if not path:
        return False
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(role + "\n")
        os.replace(tmp, path)
    except OSError:
        return False
    return True


def record_pending(session_id: str, task_name: str, role: str) -> bool:
    path = pending_file(session_id, task_name)
    if not path:
        return False
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(role + "\n")
    except OSError:
        return False
    return True


def consume_pending(session_id: str, task_name: str) -> str | None:
    path = pending_file(session_id, task_name)
    if not path:
        return None
    try:
        with open(path, encoding="utf-8") as f:
            role = f.read().strip()
    except OSError:
        return None
    if role not in ROLES:
        return None
    try:
        os.unlink(path)
    except OSError:
        pass
    return role


# --- shell rule lists, copied from opencode/agents/*.md (order matters: last match wins) -----------

D, A = "deny", "allow"

GRAPH_WRITES = [(D, f"deccy {v} *") for v in ("init", "new", "record", "remove", "undo", "redo")]

PLAN_SHELL = (
    [(D, f"jj {v} *") for v in ("new", "squash", "describe", "commit", "abandon", "rebase", "revert",
                                "restore", "split", "metaedit", "undo", "op")]
    + [(D, "jj workspace add *"), (D, "jj workspace forget *"), (D, "jj workspace update-stale *")]
    + GRAPH_WRITES
    + [(D, p) for p in ("* > *", "* >> *", "* >| *", "cat *> *", "tee *", "* | tee *")]
    + [(D, f"{c} *") for c in ("rm", "mv", "cp", "install", "dd", "truncate", "touch", "mkdir",
                               "rmdir", "ln", "chmod", "chown", "sed", "awk", "perl", "python",
                               "python3", "node", "ruby", "sh", "bash", "zsh")]
    + [(D, "git add *"), (D, "git commit *"), (D, "git checkout *"), (D, "git reset *")]
)

ORCHESTRATOR_SHELL = (
    [(D, "jj new -A *"), (D, "jj squash *"), (D, "jj rebase *"), (D, "jj describe *"),
     (A, "jj describe -m *"),
     (D, "jj op *"), (D, "jj split *"), (D, "jj metaedit *"), (D, "jj abandon *"), (D, "jj undo *"),
     (D, "jj restore *"),
     (A, "jj restore --from * --to @ -- *"), (A, "jj restore --from * --into @ -- *"),
     (A, "*abandon-empty-heads.sh*"), (A, "*delete-round-state.sh*"),
     (D, "deccy init *"), (D, "deccy remove *"),
     (D, "git commit *"), (D, "git push *"), (D, "git checkout *"), (D, "git reset *")]
    + [(D, f"{c} *") for c in ("rm", "mv", "cp", "tee", "dd", "truncate", "chmod", "chown")]
)

AUTHOR_BASE = (  # gate author and drafter share this list
    GRAPH_WRITES
    + [(D, f"jj {v} *") for v in ("new", "squash", "rebase", "describe", "op", "split", "metaedit",
                                  "abandon", "undo", "restore")]
    + [(D, "jj workspace add *"), (D, "jj workspace forget *"), (D, "jj workspace update-stale *")]
    + [(D, "git add *"), (D, "git commit *"), (D, "git reset *")]
    + [(A, "jj workspace update-stale *")]  # the protocol instructs it; last match wins
)

GATE_AUTHOR_SHELL = AUTHOR_BASE

DRAFTER_SHELL = AUTHOR_BASE + (  # a refine restores gate paths into its draft for running
    [(A, "jj restore --from * --to @ -- *"), (A, "jj restore --from * --into @ -- *")]
)

JUDGE_SHELL = (
    GRAPH_WRITES
    + [(D, f"jj {v} *") for v in ("new", "squash", "rebase", "describe", "op", "split", "metaedit",
                                  "abandon", "undo", "restore")]
    + [(A, "jj restore --from * --to @ -- *"), (A, "jj restore --from * --into @ -- *")]
    + [(D, "git add *"), (D, "git commit *"), (D, "git reset *")]
)


def policies() -> dict:
    root = agent_root()
    return {
        "deccy-plan": {
            "skills": {"deccy-core", "deccy-round"},
            "agents": set(),
            "writes": [f"{root}/plan/*"],
            "shell": PLAN_SHELL,
        },
        "deccy-orchestrator": {
            "skills": {"deccy-core", "deccy-round"},
            "agents": {"deccy-plan", "deccy-gate-author", "deccy-drafter", "deccy-judge"},
            "writes": [f"{root}/rounds/**", f"{root}/plan/*"],
            "shell": ORCHESTRATOR_SHELL,
        },
        "deccy-gate-author": {
            "skills": {"deccy-core", "deccy-gate"},
            "agents": set(),
            "writes": [f"{root}/workspaces/drafts/**"],
            "shell": GATE_AUTHOR_SHELL,
        },
        "deccy-drafter": {
            "skills": {"deccy-core", "deccy-author"},
            "agents": set(),
            "writes": [f"{root}/workspaces/drafts/**"],
            "shell": DRAFTER_SHELL,
        },
        "deccy-judge": {
            "skills": {"deccy-core", "deccy-judge"},
            "agents": set(),
            "writes": [f"{root}/workspaces/judge/**"],
            "shell": JUDGE_SHELL,
        },
    }


SHELL_TOOLS = {"Bash", "shell", "exec_command"}
WRITE_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit", "apply_patch", "ApplyPatch"}
PATCH_WRITE_TOOLS = {"apply_patch", "ApplyPatch"}


# --- shell parsing ---------------------------------------------------------------------------------

SEPARATORS = {";", "&&", "||", "|", "&", "\n", "|&"}
WRAPPERS = {"env", "command", "nohup", "time", "nice", "builtin", "exec"}
KEYWORDS = {"if", "then", "else", "elif", "do", "while", "until", "!", "{", "}"}
SHELLS = {"sh", "bash", "zsh", "dash"}
JJ_GLOBAL_WITH_ARG = {"-R", "--repository", "--at-op", "--at-operation", "--color", "--config",
                      "--config-toml", "--config-file"}
GIT_GLOBAL_WITH_ARG = {"-C", "-c", "--git-dir", "--work-tree", "--namespace"}
ASSIGN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")
SUBST = re.compile(r"\$\(([^()]*)\)|`([^`]*)`")
REDIRECT_OPS = {">", ">>", ">|", "&>", "&>>"}


def tokenize(cmd: str) -> list[str] | None:
    lex = shlex.shlex(cmd, posix=True, punctuation_chars="();&|<>")
    lex.whitespace_split = True
    lex.commenters = ""
    try:
        return list(lex)
    except ValueError:  # unbalanced quotes
        return None


def split_segments(tokens: list[str]) -> list[list[str]]:
    segs, cur = [], []
    for t in tokens:
        if t in SEPARATORS or set(t) <= set("();&|"):
            if cur:
                segs.append(cur)
            cur = []
        else:
            cur.append(t)
    if cur:
        segs.append(cur)
    return segs


def drop_devnull_redirects(seg: list[str]) -> list[str]:
    out, i = [], 0
    while i < len(seg):
        t = seg[i]
        if t in REDIRECT_OPS and i + 1 < len(seg) and seg[i + 1] == "/dev/null":
            if out and out[-1].isdigit():
                out.pop()
            i += 2
            continue
        out.append(t)
        i += 1
    return out


def normalize(seg: list[str]) -> list[str]:
    seg = list(seg)
    changed = True
    while seg and changed:
        changed = False
        while seg and ASSIGN.match(seg[0]):
            seg.pop(0)
            changed = True
        if not seg:
            break
        seg[0] = os.path.basename(seg[0])
        head = seg[0]
        if head in KEYWORDS:
            seg.pop(0)
            changed = True
        elif head in WRAPPERS:
            seg.pop(0)
            while seg and seg[0].startswith("-"):
                seg.pop(0)
            changed = True
        elif head == "timeout":
            seg.pop(0)
            while seg and seg[0].startswith("-"):
                seg.pop(0)
            if seg:
                seg.pop(0)  # the duration
            changed = True
        elif head == "xargs":
            seg.pop(0)
            while seg and seg[0].startswith("-"):
                flag = seg.pop(0)
                if flag in ("-I", "-n", "-L", "-P", "-d", "-E", "-s") and seg:
                    seg.pop(0)
            if seg:
                seg.append("<xargs-args>")
            changed = True
    if seg and seg[0] == "jj":
        rest, i = seg[1:], 0
        while i < len(rest) and rest[i].startswith("-"):
            i += 2 if rest[i] in JJ_GLOBAL_WITH_ARG else 1
        seg = ["jj"] + rest[i:]
    elif seg and seg[0] == "git":
        rest, i = seg[1:], 0
        while i < len(rest) and rest[i].startswith("-"):
            i += 2 if rest[i] in GIT_GLOBAL_WITH_ARG else 1
        seg = ["git"] + rest[i:]
    return seg


def commands(cmd: str, depth: int = 0) -> list[str] | None:
    """Every simple command in `cmd`, normalized and space-joined. None if unparseable."""
    if depth > 4:
        return None
    out: list[str] = []
    for m in SUBST.finditer(cmd):
        inner = commands(m.group(1) or m.group(2) or "", depth + 1)
        if inner is None:
            return None
        out += inner
    tokens = tokenize(cmd)
    if tokens is None:
        return None
    for seg in split_segments(tokens):
        seg = normalize(drop_devnull_redirects(seg))
        if not seg:
            continue
        if seg[0] in SHELLS and "-c" in seg[1:]:
            i = seg.index("-c")
            if i + 1 < len(seg):
                inner = commands(seg[i + 1], depth + 1)
                if inner is None:
                    return None
                out += inner
        out.append(" ".join(seg))
    return out


def match(pattern: str, text: str) -> bool:
    # OpenCode wildcard: `*` is any run of characters, `?` one; a trailing ` *` also matches the bare
    # command (`jj op *` matches `jj op`).
    if fnmatch.fnmatchcase(text, pattern):
        return True
    return pattern.endswith(" *") and fnmatch.fnmatchcase(text, pattern[:-2])


def shell_verdict(rules, text: str) -> str | None:
    verdict, hit = A, None
    for effect, pattern in rules:
        if match(pattern, text):
            verdict, hit = effect, pattern
    return hit if verdict == D else None


# --- paths -----------------------------------------------------------------------------------------

def real(path: str, cwd: str) -> str:
    path = os.path.expanduser(path)
    if not os.path.isabs(path):
        path = os.path.join(cwd or os.getcwd(), path)
    return os.path.realpath(path)


def path_allowed(path: str, cwd: str, globs: list[str]) -> bool:
    target = real(path, cwd)
    for g in globs:
        if g.endswith("/**"):
            base = real(g[:-3], "/")
            if target.startswith(base + os.sep):
                return True
        elif g.endswith("/*"):
            base = real(g[:-2], "/")
            if os.path.dirname(target) == base:
                return True
        elif target == real(g, "/"):
            return True
    return False


def patch_paths(command: str) -> list[str] | None:
    """File paths touched by an apply_patch command, or None if the patch cannot be read."""
    paths: list[str] = []
    for line in (command or "").splitlines():
        m = PATCH_FILE.match(line)
        if m:
            paths.append(m.group(2))
            continue
        m = PATCH_MOVE.match(line)
        if m:
            paths.append(m.group(1))
    return paths or None


# --- register handshake ----------------------------------------------------------------------------

def register_task(command: str) -> str | None:
    """The task name from a strict `deccy-codex register <task>` command, else None."""
    tokens = tokenize(command)
    if not tokens or len(tokens) != 3:
        return None
    prog, verb, task = tokens
    prog = prog.strip("'\"")
    if prog not in ("$DECCY_BIN", "${DECCY_BIN}") and os.path.basename(prog) != "deccy-codex":
        return None
    if verb != "register" or not TASK_NAME.fullmatch(task):
        return None
    return task


def resolve_role(event: dict) -> tuple[str | None, bool]:
    """Return (role, unregistered_child). `role` is None when the call is not ours."""
    agent_type = event.get("agent_type")
    agent_id = event.get("agent_id") or ""
    if agent_type in ROLES:
        return agent_type, False
    root_role = os.environ.get("DECCY_ROLE")
    # A Codex child has agent_type "default" and a non-empty agent_id. The root has neither.
    if agent_type == "default" and agent_id:
        if root_role not in ROLES:
            return None, False  # a deccy-free session; never interfere
        return read_role(event), True
    if root_role in ROLES:
        return root_role, False
    return None, False


def is_spawn(tool: str) -> bool:
    return tool in ("spawn_agent", "spawn") or tool.endswith("spawn_agent")


COLLAB_TOOLS = {
    "wait_agent", "send_message", "followup_task", "list_agents", "interrupt_agent",
    "close_agent", "resume_agent", "agent_status",
}


def is_collaboration(tool: str) -> bool:
    return tool.startswith("collaboration") or tool in COLLAB_TOOLS or is_spawn(tool)


# --- decision --------------------------------------------------------------------------------------

def decide(event: dict) -> str | None:
    """Return a block reason, or None to allow."""
    role, unregistered = resolve_role(event)
    tool = event.get("tool_name", "")
    args = event.get("tool_input") or {}
    cwd = event.get("cwd") or ""

    if unregistered and role is None:
        if tool in SHELL_TOOLS:
            command = args.get("command") or args.get("cmd") or ""
            task = register_task(command)
            if task:
                pending = consume_pending(event.get("session_id") or "", task)
                if pending and write_role(event, pending):
                    return None
                return ("deccy guard: no pending role for `" + task + "`. "
                        "Ask the orchestrator to spawn you with a role-prefixed task name.")
        return ("deccy guard: register your role before any other tool call. Run exactly:\n"
                "  \"$DECCY_BIN\" register <your task name>\n"
                "The task name is in your spawn message.")

    if role not in ROLES:
        return None

    pol = policies()[role]

    if is_spawn(tool):
        if role != "deccy-orchestrator":
            return f"deccy guard: {role} may not spawn subagents."
        task = args.get("task_name") or ""
        child_role = role_for_task(task)
        if not child_role:
            allowed = ", ".join(p for p, _ in TASK_ROLES)
            return (f"deccy guard: task name `{task}` is not a deccy role. "
                    f"Use one of: {allowed}.")
        if not record_pending(event.get("session_id") or "", task, child_role):
            return (f"deccy guard: could not record the pending role for `{task}`; "
                    f"check DECCY_STATE ({state_root()}).")
        return None

    if is_collaboration(tool):
        if role != "deccy-orchestrator":
            return f"deccy guard: {role} may not control subagents."
        return None

    if tool == "Skill":
        name = (args.get("skill") or "").split(":")[-1]
        if name in pol["skills"]:
            return None
        return f"deccy guard: {role} may load only {', '.join(sorted(pol['skills']))}."

    if tool in PATCH_WRITE_TOOLS:
        paths = patch_paths(args.get("command") or "")
        if not paths:
            return (f"deccy guard: {role}: could not read the apply_patch paths; "
                    f"use one Add/Update/Delete/Move section per patch.")
        for path in paths:
            if not path_allowed(path, cwd, pol["writes"]):
                return (f"deccy guard: {role} may not write `{path}`; its write scope is "
                        f"{', '.join(pol['writes'])}. A denial is a denial: do not route it "
                        f"through the shell.")
        return None

    if tool in WRITE_TOOLS:
        path = args.get("file_path") or args.get("notebook_path") or ""
        if path and path_allowed(path, cwd, pol["writes"]):
            return None
        return (f"deccy guard: {role} may not write `{path}`; its write scope is "
                f"{', '.join(pol['writes'])}. A denial is a denial: do not route it "
                f"through the shell.")

    if tool in SHELL_TOOLS:
        cmd = args.get("command") or args.get("cmd") or ""
        if register_task(cmd):
            return f"deccy guard: {role} is already registered."
        cmds = commands(cmd)
        if cmds is None:
            return f"deccy guard: could not parse the command for {role}; rewrite it plainly."
        for text in cmds:
            hit = shell_verdict(pol["shell"], text)
            if hit:
                return (f"deccy guard: {role} may not run `{text}` (rule `{hit}`). A denial is a "
                        f"denial: do not route it around the rule.")
        return None

    return None


def main() -> int:
    try:
        event = json.load(sys.stdin)
    except (ValueError, OSError):
        return 0  # global hook: never block a session we cannot identify
    if not isinstance(event, dict):
        return 0
    reason = decide(event)
    if reason:
        print(reason, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
