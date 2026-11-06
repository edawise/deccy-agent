# deccy agent — Claude Code port

## What this is

This folder is the Claude Code port of the deccy multi-agent bundle: the same five roles, the same
round protocol, wired to Claude Code's subagent files instead of a permission manifest. The skills
are shared with the bundle root (`../skills`); only the integration is Claude-specific. The round
itself — layer plan, skeleton pass, parallel components, frozen gates, clean-room judging,
user-chosen alternatives — is described in the root `README.md` and in `skills/deccy-round`; this
file covers installation, launch, and what Claude Code does and does not enforce.

Two roles are **primary sessions** and three are **subagents**:

| Role | File | How it runs |
|---|---|---|
| `deccy-plan` | `claude/agents/deccy-plan.md` | primary session (`run.sh plan`), read-only, no Edit/Write tools |
| `deccy-orchestrator` | `claude/agents/deccy-orchestrator.md` | primary session (`run.sh orchestrator`), the only graph writer |
| `deccy-gate-author` | `claude/agents/deccy-gate-author.md` | subagent, spawned by the orchestrator with Task |
| `deccy-drafter` | `claude/agents/deccy-drafter.md` | subagent, spawned by the orchestrator with Task |
| `deccy-judge` | `claude/agents/deccy-judge.md` | subagent, spawned by the orchestrator with Task, no Edit/Write tools |

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/edawise/deccy-agent/main/claude/install.sh | sh
```

The installer clones the bundle to `~/.local/share/deccy/agent/bundle` and runs
`claude/link.sh` from there. Options: `--project <dir>` for a project-local install into
`<dir>/.claude`, `--ref <branch|tag>`, `--from <dir>` to use an existing checkout in place,
`--list`, `--uninstall`, `--purge`. `REPO_URL`, `DEST_BUNDLE`, `DEST_SKILLS` and `DEST_AGENTS`
override the locations.

Manual alternative, from a clone of the repo:

```sh
git clone https://github.com/edawise/deccy-agent.git
cd deccy-agent
./claude/link.sh                    # global: ~/.claude/skills and ~/.claude/agents
./claude/link.sh --project <dir>    # <dir>/.claude/skills and <dir>/.claude/agents
./claude/link.sh --list             # show the links and their targets
./claude/link.sh --uninstall        # remove only symlinks into this bundle
```

`link.sh` symlinks only; it never copies and never replaces anything it did not create. Re-running
it after an edit to `claude/agents/*.md` is unnecessary — the links point into this repo.

```sh
./claude/link.sh                    # global: ~/.claude/skills and ~/.claude/agents
./claude/link.sh --project <dir>    # <dir>/.claude/skills and <dir>/.claude/agents
./claude/link.sh --list             # show the links and their targets
./claude/link.sh --uninstall        # remove only symlinks into this bundle
```

`DEST_SKILLS` and `DEST_AGENTS` override the destination directories. Skills come from the shared
`skills/` at the repo root; agents come from `claude/agents/`.

Install and verify:

```sh
./claude/link.sh
ls -la ~/.claude/skills/deccy-*     # five skill directories
ls -la ~/.claude/agents/deccy-*.md  # five agent files
```

Inside a session, `/agents` lists the loaded subagents (recent builds print the agents directory
and a reminder that files are edited directly). If a role is missing, check that `~/.claude/agents/`
existed when the session started — a running session does not notice a newly created `agents`
directory — and restart.

`--uninstall` removes exactly the ten links whose target is inside this repo. A foreign symlink or a
real file in either destination is left alone, and a fresh install refuses to clobber one.

## Run

The two primary roles are launched with `claude/run.sh`, which appends the agent body as a system
prompt (Claude Code cannot be started *as* an agent file):

```sh
./claude/run.sh plan "Plan the next layer for <request>"
./claude/run.sh plan                    # interactive
./claude/run.sh orchestrator "Execute the approved layer plan"
./claude/run.sh orchestrator -- --permission-mode acceptEdits
./claude/run.sh plan --print-prompt     # print the system prompt, run nothing
```

The raw equivalent, if you prefer to build the command yourself:

```sh
claude --append-system-prompt "$(./claude/run.sh plan --print-prompt)" \
       --disallowedTools "Write,Edit" -p "Plan the next layer for <request>"
```

The plan/orchestrator flow:

1. `deccy-plan` reads the graph read-only and returns one layer table **as its final message**. It
   writes nothing and has no Edit/Write tools.
2. You approve or amend the plan. On approval, `deccy-orchestrator` persists it to
   `~/.local/share/deccy/agent/plan/<round>.plan.md` and reads it back from there — the plan file is
   round state for the orchestrator, not the planner's output channel.
3. The orchestrator runs the round: skeleton pass, components, then per unit a `deccy-gate-author`
   subagent, a `deccy-drafter` subagent and a `deccy-judge` subagent, each spawned with the Task
   tool and dispatched by agent name with absolute workspace paths in the packet.
4. The orchestrator lands only judged work, keeps `~/.local/share/deccy/agent/rounds/<round>/ROUND.md`
   current, and deletes the ledger at close.

Start on a fixture repository, and launch both sessions from the graph repository's root: subagents
inherit the primary session's working directory, and the packets only work because they carry
absolute paths on top of that. This bundle has not been hardened against a large graph.

## Recommended session profiles

Claude Code enforces permissions per **session**, not per subagent: a subagent inherits the session's
rules and cannot be widened. So the primary session you launch is the security boundary, and the
role separation *between* the three subagents is protocol.

**Plan session** — remove the tools the role must not have:

```sh
./claude/run.sh plan          # already passes --disallowedTools "Write,Edit"
# or, raw:
claude --append-system-prompt "$(./claude/run.sh plan --print-prompt)" \
       --disallowedTools "Write,Edit"
```

`--disallowedTools` is the CLI form of a `deny` rule for one session. It removes the tools; it does
not confine Bash, so the plan body's "never write" rule is still what keeps the shell from
substituting for a missing `Edit` (see the enforcement table below). You can add
`--permission-mode plan` for a second, read-only layer, but the flag above is what makes the
missing tools structural. `deccy-plan.md` also lists no `Task` tool, so the plan role cannot spawn
writers once it runs as a subagent.

**Orchestrator session** — allow writes under the round root. Put this in the project's
`.claude/settings.local.json` (or `~/.claude/settings.json` for every project):

```json
{
  "permissions": {
    "allow": [
      "Bash(jj *)",
      "Bash(deccy *)",
      "Edit(~/.local/share/deccy/agent/**)"
    ],
    "additionalDirectories": [
      "~/.local/share/deccy/agent"
    ]
  }
}
```

Notes on the syntax, from the permission documentation:

- `Edit(path)` covers every built-in file-writing tool, including `Write`. A `Write(path)` rule is
  accepted but never matches, so write the `Edit` rule.
- Path patterns are gitignore syntax anchored four ways: `//path` from the filesystem root,
  `~/path` from the home directory, `/path` from the settings file's directory, and `path` or
  `./path` from the current directory. `Edit(~/.local/share/deccy/agent/**)` is therefore
  home-relative and correct; a single leading slash would *not* mean `/`.
- `additionalDirectories` extends the working directories, so reads under the round root need no
  prompt and edits follow the permission mode; the `allow` rule pre-approves the edits.
- Rules evaluate `deny`, then `ask`, then `allow`, first match wins, and a rule from any settings
  source participates — a broad deny cannot be carved out by a narrower allow.
- `Bash(prefix:*)` matches command text after splitting compound commands and stripping wrappers
  such as `timeout`, `time`, `nice`, `nohup`, `command` and bare `xargs`.

Do **not** point the plan directory at `.claude/` or `~/.claude/`. Those are protected paths: writes
there are never auto-approved, and `permissions.allow` rules are explicitly ignored for them. That is
why the approved plan lives at `~/.local/share/deccy/agent/plan/`.

## How enforcement differs from the OpenCode integration

| Layer | Mechanism | Strength |
|---|---|---|
| Tool set per role | `tools:` in `claude/agents/*.md` | **Hard.** An unlisted tool does not exist in that subagent's session; there is no prompt to click through. |
| Plan and judge are read-only | no `Edit`/`Write` in their `tools:` | **Hard.** The write has nowhere to go except the shell. |
| Session-level bans | `--disallowedTools` on the plan session, `permissions.deny` in settings | **Hard** for the session, and inherited by its subagents. |
| Within-session role separation (only the orchestrator mutates the graph; drafters stay in their workspace; the judge writes nothing) | prose "never" lists in the five bodies | **Advisory.** Nothing blocks an agent that ignores it. |
| Per-role write scope (`~/.local/share/deccy/agent/...`) | protocol prose plus an `Edit(...)` **allow** rule | **Advisory.** An allow rule pre-approves; it does not confine. Only the missing tools are confinement. |
| Bash surface (no `jj` surgery, no direct `jj abandon`, no `rm`) | prose, plus best-effort `Bash(...)` rules if you add them | **Best-effort.** Deny rules do not match an absolute path, `sh -c`, or `git -C`; they are a speed bump, not a boundary. |

The OpenCode integration expresses the same intent as per-resource permission manifests that a
subagent cannot escape. Claude Code has no per-subagent permission file, so anything finer than the
tool set is either a session-wide rule or a sentence the agent is expected to obey. Read the "hard" rows as
the contract and the "advisory" rows as the protocol; do not assume a drafter is physically unable
to write outside its workspace.

## Limitations

- **Subagent cwd.** The Task tool has no `cwd` parameter; a subagent inherits the primary session's
  working directory, and a `cd` inside a Bash call does not persist. The protocol therefore passes
  absolute workspace paths and instructs every role to `cd` for each shell command. That is the same
  limitation the bundle's README documents, not a new one.
- **Protected paths.** `.claude/` and `~/.claude/` are protected: writes to them are never
  auto-approved, allow rules are ignored, and a symlink that resolves into them is no way around it.
  Round state and the approved plan live under `~/.local/share/deccy/agent/` instead.
- **Skills load only by explicit read.** The five skills carry `disable-model-invocation: true`, so
  Claude Code neither advertises nor auto-loads them; each body names the `SKILL.md` paths to read.
  The trade-off is deliberate: the skill text enters context only when a role asks for it, which also
  means a role that skips step 1 is not prompted to fix that.
- **Bodies are adapted copies.** `claude/agents/*.md` are ports of `opencode/agents/*.md`, not the
  same file. Keep the protocol text, stop conditions and report formats in sync when the OpenCode
  agents change.
- **No per-subagent permission widening.** Claude Code subagents inherit the session's rules; there
  is no way to give `deccy-drafter` a Bash allow list that the orchestrator session does not also
  hold.
- **Session profile is manual.** Nothing in this folder stops you from launching the orchestrator
  without the settings snippet, or a plan session without `--disallowedTools`.

## Known shared-file touches

Two shared files were changed for this port; both are inert for the OpenCode integration's
behaviour.

- **`skills/*/SKILL.md` (five files)** — `name` is now the kebab-case directory name
  (`deccy-core`, `deccy-round`, `deccy-author`, `deccy-gate`, `deccy-judge`), which Claude Code's
  validators require, and each adds `disable-model-invocation: true`. The `metadata:` block that
  stops the OpenCode integration from auto-invoking the same skill is kept (Claude Code ignores
  unknown fields). Descriptions and bodies are unchanged.
- **`skills/deccy-round/references/round-protocol.md`** — the two script invocations
  (`abandon-empty-heads.sh`, `delete-round-state.sh`) no longer hardcode one install root; they use
  a `<deccy-round-skill-dir>` placeholder explained on the spot as the bundle's skill directory,
  `~/.claude/skills/deccy-round` here, or `<project>/.claude/skills/deccy-round` for a per-project
  link.
