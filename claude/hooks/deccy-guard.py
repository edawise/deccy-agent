#!/usr/bin/env python3
"""PreToolUse guard for the deccy Claude Code agents.

Claude Code has no per-agent permission manifest, but a settings-level PreToolUse hook sees every
tool call in the session and in its subagents, and its input names the calling agent
(`agent_type`). This guard applies, per role, the same rules as `opencode/agents/*.md`:

- `skill`/`subagent` allow lists       -> Skill / Agent (Task) calls
- `edit`/`write` path allow lists      -> Edit / Write / MultiEdit / NotebookEdit calls
- `shell` deny/allow patterns          -> Bash calls, checked per sub-command

Shell patterns use OpenCode semantics: `*` matches anything, rules are evaluated in order and the
last matching rule wins; no match means allow. A compound command is split on `;`, `&&`, `||`, `|`
and newlines, and `$(...)`, backticks and `sh|bash|zsh -c '...'` bodies are checked as commands
too. Leading env assignments, a path on the program name, the wrappers `env`, `command`, `nohup`,
`time`, `nice`, `timeout <n>` and `xargs [flags]`, and jj/git global options (`-R`, `-C`, ...) are
stripped before matching, so they do not slip a denied verb past the rule.

Role: the caller's `agent_type` — set both for a `claude --agent deccy-<role>` main session and for
a deccy subagent. Any other caller (a plain session, a non-deccy agent) is allowed untouched, so the
hook is safe to register globally; link.sh does that. Unreadable input is allowed for the same
reason: the guard cannot tell whose call it is.

Exit 0 allows; exit 2 blocks with the reason on stderr (Claude Code shows it to the model). This is
a guard, not a sandbox: a determined shell can still write a file the patterns do not anticipate.
"""

from __future__ import annotations

import fnmatch
import json
import os
import re
import shlex
import sys

ROLES = ("deccy-plan", "deccy-orchestrator", "deccy-gate-author", "deccy-drafter", "deccy-judge")


def agent_root() -> str:
    return os.environ.get("DECCY_GUARD_ROOT", "~/.local/share/deccy/agent")


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


WRITE_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}
AGENT_TOOLS = {"Agent", "Task"}


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


# --- decision --------------------------------------------------------------------------------------

def decide(event: dict) -> str | None:
    """Return a block reason, or None to allow."""
    role = event.get("agent_type")
    if role not in ROLES:
        return None
    tool = event.get("tool_name", "")
    args = event.get("tool_input") or {}
    cwd = event.get("cwd") or ""

    pol = policies()[role]

    if tool in AGENT_TOOLS:
        sub = args.get("subagent_type") or "general-purpose"
        if sub in pol["agents"]:
            return None
        allowed = ", ".join(sorted(pol["agents"])) or "none"
        return f"deccy guard: {role} may not dispatch `{sub}` (allowed: {allowed})."

    if tool == "Skill":
        name = (args.get("skill") or "").split(":")[-1]
        if name in pol["skills"]:
            return None
        return f"deccy guard: {role} may load only {', '.join(sorted(pol['skills']))}."

    if tool in WRITE_TOOLS:
        path = args.get("file_path") or args.get("notebook_path") or ""
        if path and path_allowed(path, cwd, pol["writes"]):
            return None
        return (f"deccy guard: {role} may not write `{path}`; its write scope is "
                f"{', '.join(pol['writes'])}. A denial is a denial: do not route it through the shell.")

    if tool == "Bash":
        cmd = args.get("command") or ""
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
