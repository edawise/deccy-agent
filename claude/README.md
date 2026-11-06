# deccy agent — Claude Code

Claude Code-specific paths, invocation, session permissions and guard-hook enforcement for the
deccy agent bundle. See the root [`README.md`](../README.md) for the shared round protocol, roles,
installer options and limitations.

## Paths & verify

`claude/link.sh` (and `claude/install.sh`) symlinks the five skills and five agents and registers
`claude/hooks/deccy-guard.py` as a `PreToolUse` hook (marked `# deccy-agent-guard`):

- **Global (default):** `~/.claude/skills/deccy-*`, `~/.claude/agents/deccy-*.md`, and
  `~/.claude/settings.json`
- **Project (`--project <dir>`):** `<dir>/.claude/skills`, `<dir>/.claude/agents`, and
  `<dir>/.claude/settings.local.json`

`DEST_SETTINGS` overrides the settings file path. `python3` is required. The settings helper
(`claude/hooks/settings-hook.py`) edits only its own hook entry, refuses invalid JSON, and writes
through a symlinked settings file rather than replacing it.

Agents, skills and settings load when a session **starts** — link before launching `claude`. In a
fresh session:

- Ask `List the subagent types you can dispatch — names only.` to confirm the five `deccy-*`
  roles.
- Type `/` to see the five `/deccy-*` slash commands (they set `disable-model-invocation: true`, so
  they do not appear in the model's auto-invoked skill list; each role reads its `SKILL.md` files
  directly).
- Run `./claude/link.sh --list` or `/hooks` in a session to confirm the guard hook is loaded.

## Run

```sh
claude --agent deccy-plan ["request"]        # interactive, or one-shot with -p "request"
claude --agent deccy-orchestrator            # interactive (recommended for a round)
```

`--agent` starts the session as that agent file: Claude Code applies the file's `tools:` list
(including `Agent(deccy-plan, deccy-gate-author, deccy-drafter, deccy-judge)` on the orchestrator)
and replaces the default system prompt with the role body. Combine with `--model <model>` as
needed.

If you run `claude --agent deccy-orchestrator` when no approved plan exists at
`~/.local/share/deccy/agent/plan/`, it spawns `deccy-plan` as a subagent, shows the layer table,
and persists the approved plan to `~/.local/share/deccy/agent/plan/<round>.plan.md` in the same
session. Alternatively, run `claude --agent deccy-plan` first and pass the approved table into a
fresh `deccy-orchestrator` session.

## Recommended session permissions

Claude Code permission rules are session-wide: subagents inherit them and cannot be widened, while
the guard hook narrows each role by its `agent_type`.

- **Plan session** (`claude --agent deccy-plan`) needs no extra flags. Its `tools:` are `Read`,
  `Glob`, `Grep`, `Bash`, `Edit`, `Write` and `AskUserQuestion`; the guard confines writes to
  `~/.local/share/deccy/agent/plan/` with a read-only shell.
- **Orchestrator session** (`claude --agent deccy-orchestrator`) should run with
  `--permission-mode acceptEdits` (or `Shift+Tab` once in session) so graph writes do not stall on
  manual approval prompts, plus pre-approval rules in `.claude/settings.local.json` or
  `~/.claude/settings.json`:

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

Permission syntax notes:

- `Edit(path)` covers all built-in file-writing tools including `Write` (`Write(path)` never
  matches).
- Path patterns use gitignore syntax anchored four ways: `//path` (filesystem root), `~/path`
  (home), `/path` (settings file directory), and `path` or `./path` (working directory).
- `additionalDirectories` allows reads under the round root without prompts; `allow` pre-approves
  edits while the guard still blocks out-of-role actions.
- Rules evaluate `deny` → `ask` → `allow` (first match wins across all settings sources).
- `Bash(prefix:*)` matches after splitting compound commands and stripping wrappers (`timeout`,
  `time`, `nice`, `nohup`, `command`, bare `xargs`).
- `.claude/` and `~/.claude/` are protected paths where writes are never auto-approved and
  `permissions.allow` is ignored; that is why plans live at `~/.local/share/deccy/agent/plan/`.

## Enforcement

| OpenCode manifest entry | Claude Code mechanism |
|---|---|
| tool availability | `tools:` in `claude/agents/*.md`, applied to `--agent` sessions and subagents |
| `skill` allow list | guard blocks `Skill` calls outside the role's two skills |
| `subagent` allow list | `Agent(...)` in the orchestrator's `tools:`, plus the guard |
| `edit` / `write` paths | guard blocks `Edit`/`Write`/`MultiEdit`/`NotebookEdit` outside the role's paths (`plan` → `plan/*`, `orchestrator` → `rounds/**` + `plan/*`, `gate-author` and `drafter` → `workspaces/drafts/**`, `judge` → `workspaces/judge/**`) |
| `shell` deny/allow patterns | guard evaluates the same patterns in order (last match wins) |
| `question` (planner) | `AskUserQuestion` in the planner's `tools:` (interactive sessions) |

`claude/hooks/deccy-guard.py` reads `agent_type` from the hook input (set for both
`claude --agent deccy-<role>` sessions and `deccy-*` subagents) and passes any other caller through
untouched. The hook's matcher is `Bash|Edit|Write|MultiEdit|NotebookEdit|Agent|Task|Skill`. For
`Bash` calls, it checks every sub-command of compound commands (`;`, `&&`, `||`, `|`, subshells, loops), `$(...)`,
backticks and `sh -c`, stripping env assignments, program paths, command wrappers and `jj`/`git`
global options before matching (`*` matches anything; trailing ` *` also matches the bare command;
redirects to `/dev/null` are not treated as writes).

The registered hook command **fails open** if the guard file or `python3` is missing so a moved or
deleted bundle does not block every Claude session, and exits `2` when the guard denies a call or
crashes. Run the hook tests with:

```sh
python3 -m unittest discover -s claude/hooks
```

Claude-specific caveats:

- **Guard, not sandbox.** As with OpenCode's pattern list, an unlisted interpreter or write path
  can bypass shell pattern matching; the prose "never" rules still apply, and drafters are scoped
  to `workspaces/drafts/**` rather than per-unit subdirectories.
- **Settings hook required.** Frontmatter hooks in agent files do not fire (tested on Claude Code
  2.1.319), so sessions started without the settings file (e.g. excluded via `--setting-sources`)
  enforce only `tools:`.
- **Adapted agent files.** `claude/agents/*.md` and `deccy-guard.py` are ports of
  `opencode/agents/*.md`; keep their protocol text and permission lists in sync.
