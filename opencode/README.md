# deccy agent — OpenCode integration

## What this is

This folder is the OpenCode integration of the deccy multi-agent bundle: the same five roles as
OpenCode agent files, each with an explicit permission manifest. The skills are shared with the
bundle root (`../skills`); only the integration is OpenCode-specific. The round itself — layer
plan, skeleton pass, parallel components, frozen gates, clean-room judging, user-chosen
alternatives — is described in the root `README.md` and in `skills/deccy-round`; this file covers
installation, launch, and how OpenCode enforces the roles.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/edawise/deccy-agent/main/opencode/install.sh | sh
```

The installer clones the bundle to `~/.local/share/deccy/agent/bundle` and runs
`opencode/link.sh` from there. Options: `--project <dir>` for a project-local install into
`<dir>/.opencode`, `--ref <branch|tag>`, `--from <dir>` to use an existing checkout in place,
`--list`, `--uninstall`, `--purge`. `REPO_URL`, `DEST_BUNDLE`, `DEST_SKILLS` and `DEST_AGENTS`
override the locations.

Manual alternative, from a clone of the repo:

```sh
git clone https://github.com/edawise/deccy-agent.git
cd deccy-agent
./opencode/link.sh                      # global: ~/.config/opencode/{skills,agents}
./opencode/link.sh --project <dir>      # <dir>/.opencode/{skills,agents}
./opencode/link.sh --list               # show the links and their targets
./opencode/link.sh --uninstall          # remove only symlinks into this bundle
```

`link.sh` symlinks only; it never copies and never replaces anything it did not create. Re-running
it after an edit is unnecessary — the links point into the checkout (or into the bundle clone,
which `git pull`s in place, so updates stay live).

`DEST_SKILLS` and `DEST_AGENTS` override the destination directories. Skills come from the shared
`skills/` at the bundle root; agents come from `opencode/agents/`.

**Per-project links in a jj-managed repo:** jj snapshots the `.opencode/` links into the working
copy as new files, and round operations (`jj abandon`, working-copy updates) can delete them —
observed in practice with the Claude port's equivalent. Add `.opencode/` to the project's
`.gitignore` before linking (jj respects gitignore), or use the global install, which
sidesteps the problem entirely.

Install and verify:

```sh
opencode debug agents | grep deccy
ls -la ~/.config/opencode/skills/deccy-*   # five skill directories
```

## Agents

Two roles are **primary sessions** (`mode: all`) and three are **subagents** spawned by the
orchestrator:

| ID | Mode | Use |
|---|---|---|
| `deccy-plan` | all | produce one layer plan (breadth only); read-only |
| `deccy-orchestrator` | all | run the round; only graph writer |
| `deccy-gate-author` | subagent | write one evaluation + red test |
| `deccy-drafter` | subagent | implement one decision |
| `deccy-judge` | subagent | judge a candidate |

## Run one

```sh
opencode run --agent deccy-plan "Plan the next layer for <request>"
opencode run --agent deccy-orchestrator "Execute the approved layer plan"
```

Start with `deccy-plan` to get a layer plan, then `deccy-orchestrator` to execute it. The
orchestrator launches the other three roles. Use a fixture repository first: this bundle has not
been hardened against a large graph (hundreds of nodes).

## Enforcement

OpenCode enforces each role's tools and write scope from the per-agent `permissions:` manifests in
`opencode/agents/*.md`: a denied action has no path to run. The Claude Code port expresses the same
intent mostly as session-level rules and protocol prose, which it documents as advisory — see
`../claude/README.md`.
