# deccy agent — Codex

Codex-specific paths, invocation, role routing and guard enforcement for the deccy agent bundle.
See the root [`README.md`](../README.md) for the shared round protocol, roles, installer options
and limitations.

## Requirements

- **Codex CLI 0.167.0 or newer.** The bundle is tested at `0.167.0`; `codex/install.sh` refuses an
  older release. See [Upgrading Codex](#upgrading-codex) before moving to a newer one.
- `python3` for the guard hook, the `hooks.json` helper and the deccy check scripts.
- `jj` for draft workspaces and graph changes, and `deccy` for graph writes. Both are checked when
  a role starts and produce a warning if missing.
- `git` for the installer's clone; an existing `--from` checkout does not need it.

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

Codex loads non-managed hooks only after they are reviewed and trusted; see
[Hook trust](#hook-trust-hooks) before the first round.

Verify the links:

```sh
ls -la ~/.agents/skills/deccy-*
./codex/link.sh --list
```

## Hook trust (`/hooks`)

`link.sh` writes the guard into `hooks.json`, but Codex does not run a non-managed hook until you
review and trust it. Trust belongs to that `hooks.json` file, so it follows the target you linked.

1. Install or link the bundle, then start Codex from the graph repository root (the launcher is
   optional for this step; plain `codex` is enough).
2. Run `/hooks` and open the `PreToolUse` entry whose command ends with
   `# deccy-agent-codex-guard`.
3. Review the command and trust it. It runs `python3 <bundle>/codex/hooks/deccy-guard.py`; confirm
   the path is a bundle you control.
4. For a project install, trust the project `.codex/` layer as well. A global `/hooks` trust does
   not cover a project hooks file, and a project trust does not cover the global file.
5. Re-trust after reinstalling or linking to a different bundle, and whenever Codex reports the hook
   as untrusted or changed. Editing `hooks.json` invalidates the previous trust decision.

Check that the hook is live: ask the agent for a shell command or edit the guard should deny, for
example a write outside the role's scope. A denied call exits `2` and shows the guard's message. If
the call runs, the hook is untrusted and only the role prompt is enforcing the boundary.

Automation and disposable fixtures may pass `--dangerously-bypass-hook-trust` to `codex` (or through
`deccy-codex ... exec`). It skips the persisted trust check for that invocation only; do not put it
in an alias or use it for a normal session. Every bypass is a decision that you have vetted the hook
source yourself.

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

## Upgrading Codex

Codex's hook payload, tool names and V2 spawn arguments are not a stable public API. The bundle is
tested at `0.167.0`; a newer CLI can change any surface the guard matches.

After `codex update` (or a package upgrade):

1. Run `codex --version` and confirm it is still `0.167.0` or newer.
2. Re-run the hook tests:

   ```sh
   python3 -m unittest discover -s codex/hooks
   ```

3. Open `/hooks`, re-trust the guard if Codex reports it changed, and confirm a denied call still
   exits `2` with the guard's message.
4. Check the surfaces the port depends on:
   - shell calls arrive as `Bash`;
   - edits arrive as `apply_patch` with `*** Begin Patch`, `*** Add File:`, `*** Update File:`,
     `*** Delete File:` and `*** Move to:`;
   - spawning arrives as `collaborationspawn_agent` with `tool_input.task_name`;
   - `spawn_agent` accepts `task_name`, `message`, `fork_turns`, `model` and `reasoning_effort`;
   - child calls expose `agent_id`, and the registration handshake still binds it.
5. Run a one-unit fixture round before a real round.

When a surface moves, update the guard, `codex/hooks/test_deccy_guard.py`, the role prompts and the
tables in this README in one change so the pinned version and the tests stay honest.

## Codex-specific caveats

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
  the deccy hook and only the prompts enforce the role boundaries; see
  [Hook trust](#hook-trust-hooks).
