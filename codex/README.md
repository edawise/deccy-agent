# deccy agent — Codex

Codex-specific paths, invocation, role routing and guard enforcement for the deccy agent bundle.
See the root [`README.md`](../README.md) for the shared round protocol, roles, installer options
and limitations.

## Paths & verify

`codex/link.sh` (and `codex/install.sh`) symlinks the five shared skills, links the `deccy-codex`
launcher and registers `codex/hooks/deccy-guard.py` as a `PreToolUse` hook (marked
`# deccy-agent-codex-guard`):

- **Global (default):** `~/.agents/skills/deccy-*`, `~/.codex/hooks.json`, and
  `~/.local/bin/deccy-codex`
- **Project (`--project <dir>`):** `<dir>/.agents/skills`, `<dir>/.codex/hooks.json`, and
  `<dir>/.codex/bin/deccy-codex`

`DEST_SKILLS`, `DEST_HOOKS` and `DEST_BIN` override the global destinations. `python3` is required.
The hook helper (`codex/hooks/settings-hook.py`) edits only its own hook entry, refuses invalid
JSON, and writes through a symlinked `hooks.json` rather than replacing it.

Codex loads non-managed hooks only after they are reviewed and trusted. Open `/hooks` in a session
and trust the deccy entry before the first round. Project hooks load only when the project `.codex/`
layer is trusted.

Verify the links and the hook:

```sh
ls -la ~/.agents/skills/deccy-*
./codex/link.sh --list
# then /hooks inside a Codex session
```

## Run

```sh
deccy-codex plan ["request"]          # planner root session
deccy-codex orchestrator              # orchestrator root session (recommended for a round)
deccy-codex plan exec "<request>"     # non-interactive planner
```

Both modes load `codex/roles/<role>.md` as Codex developer instructions and set
`DECCY_ROLE`, `DECCY_BUNDLE`, `DECCY_SKILLS`, `DECCY_BIN`, `DECCY_AGENT_ROOT` and `DECCY_STATE`.
The planner session starts with multi-agent spawning disabled; the orchestrator starts with it
enabled.

If you run `deccy-codex orchestrator` when no approved plan exists at
`~/.local/share/deccy/agent/plan/`, it spawns the `deccy-plan` child first, shows the layer table,
and persists the approved plan to `~/.local/share/deccy/agent/plan/<round>.plan.md` before the
skeleton pass. Alternatively, run `deccy-codex plan` first and pass the approved table into a fresh
`deccy-codex orchestrator` session.

## Child registration

Codex's V2 `spawn_agent` accepts `task_name`, `message`, `fork_turns`, `model` and
`reasoning_effort`; it has no custom `agent_type`. The orchestrator therefore uses role-prefixed
task names and `fork_turns="none"`:

| Role | Task-name prefix |
|---|---|
| `deccy-plan` | `deccy_plan_` |
| `deccy-gate-author` | `deccy_gate_author_` |
| `deccy-drafter` | `deccy_drafter_` |
| `deccy-judge` | `deccy_judge_` |

The spawned child's first command is:

```sh
deccy-codex register <task_name>
```

The guard records the pending role from the spawn event and binds the child's `agent_id` when the
registration command runs. Every later call in that child is checked against the bound role. A
child cannot register a task name that does not match its pending spawn.

## Enforcement

| OpenCode manifest entry | Codex mechanism |
|---|---|
| tool availability | role prompts plus the guard; root roles start from `deccy-codex` |
| `skill` allow list | guard reads `DECCY_ROLE` / the registered child role and enforces each role's skill set |
| `subagent` allow list | only the orchestrator may spawn; task-name prefixes must match a known role |
| `edit` / `write` paths | guard parses `apply_patch` (`Add`, `Update`, `Delete`, `Move`) and checks every path against the role's scope |
| `shell` deny/allow patterns | guard evaluates the same patterns in order (last match wins) |
| `question` (planner) | no separate question tool; the planner asks in its final message |

The registered matcher is `Bash|apply_patch|Edit|Write|collaboration.*|spawn_agent`. The hook
command **fails open** if the guard file or `python3` is missing so a moved or deleted bundle does
not block every Codex session, and exits `2` when the guard denies a call or crashes.

Run the guard and hook tests with:

```sh
python3 -m unittest discover -s codex/hooks
```

Codex-specific caveats:

- **Guard, not sandbox.** Subagents inherit the parent's sandbox and filesystem access. The guard
  scopes writes and shell commands; it does not create a per-role filesystem or permission
  boundary. The prompts forbid reading another role's workspace.
- **Shared cwd.** `spawn_agent` has no `cwd` parameter. Launch from the graph repository root and
  use absolute workspace paths (or `cd "$WS"` in shell calls); the prompts require this.
- **Custom agents are not selectable.** `codex/agents/*.toml` files would be dead configuration
  under the current V2 spawn surface, so the bundle ships role prompts and the registration
  handshake instead.
- **Spawned children inherit `DECCY_ROLE`.** The guard never trusts that inherited value for a
  child; it resolves the child's role from the registration map.
- **Hook trust.** Without `/hooks` trust (or `--dangerously-bypass-hook-trust`), Codex does not run
  the deccy hook and only the prompts enforce the role boundaries.
