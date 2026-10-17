# deccy-agent

Shareable bundle for working on projects that use a **deccy (decision) graph**: one change = one
node = one decision, with evaluations covering every dependency edge. Graph work goes through the
`deccy` CLI.

- `skills/deccy-agent/` — the skill (ID `deccy-agent`, from the directory name): mental model,
  invariants, decision placement, deccy CLI workflow, evaluation conventions.
- `agents/deccy-agent.md` — the agent (`mode: all`, usable as a primary agent or a subagent).
  Its procedure loads the skill first.

## Install from GitHub

```sh
curl -fsSL https://raw.githubusercontent.com/edawise/deccy-agent/main/install.sh | sh
```

Or clone and run locally:

```sh
git clone https://github.com/edawise/deccy-agent
./deccy-agent/install.sh
```

This installs globally (`~/.config/opencode/skills/deccy-agent/`,
`~/.config/opencode/agents/deccy-agent.md`). Options:

```sh
./install.sh --project <dir>         # project-local install into <dir>/.opencode
./install.sh --ref <branch|tag|sha>  # install a specific ref instead of main
./install.sh --uninstall             # remove installed files (add --project for local)
REPO_URL=<fork-url> ./install.sh     # install from a fork instead
```

Re-run to update. To uninstall, `./install.sh --uninstall`.

## pi workflows (deccy-edit)

The `pi/` tree adds the pi SDK workflows (planner + executor + direct editor),
the interactive `deccy-plan` pi skill, and the plan gate. Install them the
same way:

```sh
curl -fsSL https://raw.githubusercontent.com/edawise/deccy-agent/main/install-pi.sh | sh
```

That installs `pi/` to `~/.pi/agent/deccy-agent` (runs `npm install` once),
symlinks the skills into `~/.pi/agent/skills/` (pi discovers them), and adds
`deccy-edit` commands to `~/.local/bin`.

```sh
deccy-edit -i  
deccy-edit "<request>" --graph /path/to/deccy-repo   # simple edits / node adds   
```

Options mirror `install.sh`: `--project <dir>` (skills into `<dir>/.pi/skills`),
`--ref`, `--uninstall`, `REPO_URL`/`DEST_APP`/`DEST_SKILLS`/`DEST_BIN` env
overrides. Needs Node ≥ 22, and `deccy`/`jj`/`python3` on PATH for real runs.
User docs: `pi/README.md`.

If `edawise/deccy-agent` is not the real repo location, replace it with the actual URL above (and
in `install.sh`'s `REPO_URL` default) before sharing.

## Manual install

Copy the directories into place — no config needed:

```sh
cp -r skills/deccy-agent ~/.config/opencode/skills/
cp agents/deccy-agent.md ~/.config/opencode/agents/
```

For per-project sharing instead, copy into `<project>/.opencode/skills/` and
`<project>/.opencode/agents/`.

## Notes

- The skill ID is path-derived: the directory must stay named exactly `deccy-agent`.
- If a recipient already has a `deccy-agent` ID from another source, the later-registered source takes precedence (explicit `skills` config entries and project `.opencode/` override global).
- This repository is the zeroth version of the skill and agent, and thus does not use the deccy framework itself. It is a bootstrap for working on projects that will use deccy.
