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
| gate-author / drafter / judge | never directly: the orchestrator dispatches them with the Task tool by name. Any Claude session can also dispatch them on request ("use the `deccy-judge` subagent to …") |

`deccy-claude` (or `claude/run.sh` from a checkout) appends the agent file's body as the
session's system prompt — Claude Code cannot be started *as* an agent file, so this is the
`mode: all` equivalent of the OpenCode bundle. From a checkout without the launcher, use an
alias:

```sh
alias deccy-claude='/path/to/deccy-agent/claude/run.sh'
```

Do not symlink `run.sh` into a bin directory: it locates its agent files relative to itself.
Arguments after `--` pass through to `claude` — `deccy-claude plan "…" -- --model <model>` is
worth using, since a weak session default makes for weak planning. The plan session already
passes `--disallowedTools "Write,Edit"` itself.

The raw equivalent, if you prefer to build the command yourself:

```sh
claude --append-system-prompt "$(./claude/run.sh plan --print-prompt)" \
       --disallowedTools "Write,Edit" -p "Plan the next layer for <request>"
```

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
subagent — each spawned with the Task tool, dispatched by agent name, with absolute workspace
paths in the packet. It lands only judged work, keeps
`~/.local/share/deccy/agent/rounds/<round>/ROUND.md` current, and deletes the ledger at close.

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
