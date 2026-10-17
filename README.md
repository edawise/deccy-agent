# deccy-agent

Shareable bundle for working on projects that use a **deccy (decision) graph**: one change = one
node = one decision, with evaluations covering every dependency edge. Graph work goes through the
`deccy` CLI.

The repo ships two independent distributions — each with its own installer, install locations, and
scope:

- **OpenCode** — the skill + agent: `skills/deccy-agent/` (skill ID `deccy-agent`, from the
  directory name): mental model, invariants, decision placement, deccy CLI workflow, evaluation
  conventions; and `agents/deccy-agent.md` (the agent, `mode: all`, usable as a primary agent or a
  subagent; its procedure loads the skill first). Installer: `install.sh`.
- **pi** — the `pi/` tree: the `deccy-edit` pi SDK workflow (direct edits and node adds on a
  graph, no plan artifact) plus the `deccy-agent` skill. Installer: `install-pi.sh`.
  Docs: `pi/README.md`.

## OpenCode install

From GitHub:

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

Manual install — copy the directories into place, no config needed:

```sh
cp -r skills/deccy-agent ~/.config/opencode/skills/
cp agents/deccy-agent.md ~/.config/opencode/agents/
```

For per-project sharing instead, copy into `<project>/.opencode/skills/` and
`<project>/.opencode/agents/`.

## pi install

From GitHub:

```sh
curl -fsSL https://raw.githubusercontent.com/edawise/deccy-agent/main/install-pi.sh | sh
```

This installs `pi/` to `~/.pi/agent/deccy-agent` (runs `npm install` once), symlinks the skill
into `~/.pi/agent/skills/` (pi discovers it), and adds the `deccy-edit` command to `~/.local/bin`.
Then:

```sh
deccy-edit -i
deccy-edit "<request>" --graph /path/to/deccy-repo   # simple edits / node adds
```

Options mirror `install.sh`: `--project <dir>` (skill link into `<dir>/.pi/skills`), `--ref`,
`--uninstall`, `REPO_URL`/`DEST_APP`/`DEST_SKILLS`/`DEST_BIN` env overrides. Needs Node ≥ 22, and
`deccy`/`jj`/`python3` on PATH for real runs. User docs and run-from-checkout instructions:
`pi/README.md`.

## Notes

- The skill ID is path-derived: the directory must stay named exactly `deccy-agent`.
- If a recipient already has a `deccy-agent` ID from another source, the later-registered source takes precedence (explicit `skills` config entries and project `.opencode/` override global).
- If `edawise/deccy-agent` is not the real repo location, replace it with the actual URL above (and in `install.sh`'s and `install-pi.sh`'s `REPO_URL` defaults) before sharing.
- This repository is the zeroth version of the skill and agent, and thus does not use the deccy framework itself. It is a bootstrap for working on projects that will use deccy.
