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
| `deccy-plan` | `claude/agents/deccy-plan.md` | primary session (`run.sh plan`) or subagent; writes only plan files |
| `deccy-orchestrator` | `claude/agents/deccy-orchestrator.md` | primary session (`run.sh orchestrator`), the only graph writer |
| `deccy-gate-author` | `claude/agents/deccy-gate-author.md` | subagent, spawned by the orchestrator with the Agent tool |
| `deccy-drafter` | `claude/agents/deccy-drafter.md` | subagent, spawned by the orchestrator with the Agent tool |
| `deccy-judge` | `claude/agents/deccy-judge.md` | subagent, spawned by the orchestrator with the Agent tool; writes only judge workspaces |

Each role's OpenCode permission list (skills, subagents, edit paths, shell patterns) is enforced by
`claude/hooks/deccy-guard.py`, a PreToolUse hook that `run.sh` loads for the session and every deccy
subagent it spawns. See "How enforcement compares with OpenCode" below.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/edawise/deccy-agent/main/claude/install.sh | sh
```

One command; three things land:

- the five skills symlinked into `~/.claude/skills/deccy-*` and the five agents into
  `~/.claude/agents/deccy-*.md` — **global**: every Claude session on the machine sees them
  (skills stay invisible to models until invoked, by design);
- a clone of the bundle at `~/.local/share/deccy/agent/bundle`, shared with the OpenCode
  installer — update it with `git -C ~/.local/share/deccy/agent/bundle pull`; the links stay live;
- a `deccy-claude` launcher in `~/.local/bin`, so `deccy-claude plan` and
  `deccy-claude orchestrator` work from any directory. The installer warns if `~/.local/bin`
  is not on your PATH.

Installer options: `--project <dir>` (links into `<dir>/.claude` instead of global),
`--ref <branch|tag>`, `--from <dir>` (use an existing checkout in place — also the dev/test
path), `--list`, `--uninstall` (removes the links and the launcher), `--purge` (also removes
the bundle clone, and only when no other integration still links into it). `REPO_URL`,
`DEST_BUNDLE`, `DEST_BIN`, `DEST_SKILLS` and `DEST_AGENTS` override the locations.

**Per-project links in a jj-managed repo:** jj snapshots the `.claude/` links into the working
copy as new files, and round operations (`jj abandon`, working-copy updates) can delete them —
observed in practice. Add `.claude/` to the project's `.gitignore` before linking (jj respects
gitignore), or use the global install, which sidesteps the problem entirely.

Manual alternative, from a clone of the repo (links only — no launcher; use the alias in
"Run" below):

```sh
git clone https://github.com/edawise/deccy-agent.git
cd deccy-agent
./claude/link.sh                    # global: ~/.claude/skills and ~/.claude/agents
./claude/link.sh --project <dir>    # <dir>/.claude/skills and <dir>/.claude/agents
./claude/link.sh --list             # show the links and their targets
./claude/link.sh --uninstall        # remove only symlinks into this bundle
```

`link.sh` symlinks only; it never copies and never replaces anything it did not create —
re-running it after an edit to `claude/agents/*.md` is unnecessary, the links point into the
repo. `DEST_SKILLS` and `DEST_AGENTS` override the destination directories; a foreign symlink
or a real file in either destination is left alone, and a fresh install refuses to clobber
one. Skills come from the shared `skills/` at the repo root; agents come from `claude/agents/`.

### Verify

Agents and skills load when a session **starts**; a running session never notices a newly
linked `.claude/` — link first, then start the session. The `/agents` wizard was removed in
Claude Code v2.1.198, and `/list-agents` lists *running* peers rather than definitions, so
neither can check this. From a fresh session, in any directory:

```text
List the subagent types you can dispatch — names only.
```

The answer must name the five `deccy-*` roles. Typing `/` alone shows the five skills as
slash commands (`/deccy-core` runs one); they never appear in the model's own skill list
(`disable-model-invocation`), so the slash menu is the user-side check.

## Run

| Role | How you invoke it |
|---|---|
| `deccy-plan` | `deccy-claude plan ["request"]` — with a request, one-shot: the layer table prints to the terminal; without, interactive |
| `deccy-orchestrator` | `deccy-claude orchestrator ["request"]` — without a request, interactive (recommended for a round) |
| gate-author / drafter / judge | never directly: the orchestrator dispatches them with the Agent tool by name. Any Claude session can also dispatch them on request ("use the `deccy-judge` subagent to …"), but only a `run.sh` session (or the global hook below) guards them |

`deccy-claude` (or `claude/run.sh` from a checkout) has two launch modes — the `mode: all`
equivalent of the OpenCode bundle — and loads the guard hook in both:

| | `--mode append` (default) | `--mode agent` |
|---|---|---|
| Command | `claude --append-system-prompt <body> --tools <tools: line>` | `claude --agent deccy-<role>` |
| System prompt | Claude Code's default prompt **plus** the role body | the role body **replaces** Claude Code's default prompt (the session opens "You are a Claude agent, built on Anthropic's Claude Agent SDK"); tool descriptions keep their own guidance |
| Tool set | `tools:` line applied with `--tools` | `tools:` line applied by Claude Code |
| Subagent allow list | guard hook only | `Agent(...)` in `tools:` **and** the guard hook |
| Needs the agents linked | no — runs from a checkout | yes (`link.sh` / `install.sh`) |

Both are kept until a fixture round shows whether the role bodies are enough without Claude Code's
default prompt. `DECCY_CLAUDE_MODE=agent` makes `agent` the default. From a checkout without the
launcher, use an alias:

```sh
alias deccy-claude='/path/to/deccy-agent/claude/run.sh'
```

Do not symlink `run.sh` into a bin directory: it locates its agent files and the guard relative to
itself. Arguments after `--` pass through to `claude` — `deccy-claude plan "…" -- --model <model>`
is worth using, since a weak session default makes for weak planning. `python3` is required (the
guard is Python, like the check scripts).

### Plan, then round

One session is enough. Run `deccy-claude orchestrator` with no request: it finds no approved
plan at `~/.local/share/deccy/agent/plan/`, so it spawns the `deccy-plan` subagent itself,
shows you the layer table, and — once you approve **in the same session** — persists the plan
to `~/.local/share/deccy/agent/plan/<round>.plan.md` and runs the round. Nothing is lost
between planning and execution, because the planner ran as a child of the session that
executes.

Two sessions also work, when you want to iterate on a plan before committing to a round:
`deccy-claude plan "…"` prints the table, you amend it outside the session, then
`deccy-claude orchestrator` starts fresh and you hand the approved table over in your first
message ("this is the approved layer plan; persist it and execute it"). The table is the only
thing that crosses between the sessions — the plan is an artifact, not chat context.

Either way, the orchestrator then runs the round: skeleton pass, partition into components,
then per unit a `deccy-gate-author` subagent, a `deccy-drafter` subagent and a `deccy-judge`
subagent — each spawned with the Agent tool, dispatched by agent name, with absolute workspace
paths in the packet. It lands only judged work, keeps
`~/.local/share/deccy/agent/rounds/<round>/ROUND.md` current, and deletes the ledger at close.

Start on a fixture repository, and launch both sessions from the graph repository's root: subagents
inherit the primary session's working directory, and the packets only work because they carry
absolute paths on top of that. This bundle has not been hardened against a large graph.

## Recommended session profiles

Claude Code's permission *rules* are per session: a subagent inherits them and cannot be widened.
The per-role separation comes from the guard hook instead, which reads the calling agent's
`agent_type` from the hook input and applies that role's list.

**Plan session** — `./claude/run.sh plan` needs nothing extra. Its tools are Read, Glob, Grep, Bash,
Edit, Write and AskUserQuestion. The guard confines Edit/Write to `~/.local/share/deccy/agent/plan/`
and applies OpenCode's read-only shell list. The planner cannot dispatch agents.

**Orchestrator session** — run it with `--permission-mode acceptEdits` (or Shift+Tab once after
it opens): on Manual, the round stalls on an approval prompt for nearly every graph write. Then
allow writes under the round root. Put this in the project's `.claude/settings.local.json` (or
`~/.claude/settings.json` for every project):

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

## How enforcement compares with OpenCode

| OpenCode manifest entry | Claude Code mechanism |
|---|---|
| tool availability | `tools:` in `claude/agents/*.md` — applied by Claude Code (subagents, `--mode agent`) or by `--tools` (`--mode append`) |
| `skill` allow list | guard: Skill calls outside the role's two skills are blocked |
| `subagent` allow list (orchestrator: the four roles) | guard, plus `Agent(...)` in the orchestrator's `tools:` under `--mode agent` |
| `edit` / `write` path allow list | guard: Edit/Write/MultiEdit/NotebookEdit outside the role's paths are blocked (plan → `plan/*`, orchestrator → `rounds/**` + `plan/*`, gate author and drafter → `workspaces/drafts/**`, judge → `workspaces/judge/**`) |
| `shell` deny/allow patterns | guard: the same patterns, in the same order, last match wins |
| `question` (planner) | `AskUserQuestion` in the planner's `tools:` (interactive sessions only) |

The guard (`claude/hooks/deccy-guard.py`) matches shell patterns with OpenCode's semantics (`*`
matches anything; a trailing ` *` also matches the bare command). It checks every sub-command of a
compound command (`;`, `&&`, `||`, `|`, subshells, loops), the bodies of `$(...)`, backticks and
`sh -c`, and strips env assignments, program paths, the wrappers `env`/`command`/`nohup`/`time`/
`nice`/`timeout`/`xargs`, and jj/git global options before matching. Redirects to `/dev/null` are
not treated as writes. A guard that crashes or is missing blocks the call (`|| exit 2`).

What it does **not** give you:

- **It is a guard, not a sandbox** — the same as OpenCode's pattern lists. A shell that writes
  through a path no pattern anticipates (an unlisted interpreter for the drafter, say) gets through;
  the prose "never" rules still apply.
- **Within the drafts root, not per workspace.** A drafter may write anywhere under
  `workspaces/drafts/`, as in OpenCode; staying in its *own* workspace is protocol.
- **Only `run.sh` sessions are guarded.** Hooks declared in an agent file's frontmatter do not fire
  (tested on Claude Code 2.1.319), so the guard rides on `--settings`. A deccy subagent dispatched
  from an ordinary Claude session is unguarded unless you add the hook globally — safe, because
  without `--main-role` the guard only acts on the five deccy agent types:

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "*",
        "hooks": [{ "type": "command",
                    "command": "python3 ~/.local/share/deccy/agent/bundle/claude/hooks/deccy-guard.py || exit 2" }] }
    ]
  }
}
```

Run the guard's tests with `python3 -m unittest discover -s claude/hooks`.

## Limitations

- **Subagent cwd.** The Agent tool has no `cwd` parameter; a subagent inherits the primary session's
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
- **No per-subagent permission widening.** Claude Code subagents inherit the session's permission
  rules; the guard can only *narrow* a role, never pre-approve something the session would prompt for.
- **The orchestrator's approval profile is manual.** `run.sh` loads the guard but not the
  `acceptEdits` mode or the allow snippet above; without them the round stalls on prompts.

## Known shared-file touches

Three shared files were changed for this port; all are inert for the OpenCode integration's
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
- **`skills/deccy-core` reference text** — the topology/custody check-script invocations no
  longer point at a project-root `scripts/` that nothing creates; they now use the
  `CORE="<deccy-core skill base directory>"` + `"$CORE/scripts/check-*.py"` form with the three
  install roots named on the spot, matching `round-protocol.md` §9. This fixes the missing path
  for both integrations.
