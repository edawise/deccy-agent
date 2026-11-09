# deccy agent

Multi-agent bundle for deccy graph work.

The bundle:

- split the broad skill into a small core plus four role skills;
- plan one **layer** of nodes at a time — breadth only, one row per node — instead of a full
  round brief per topic;
- create every skeleton in one pass, then partition the layer into **components** that run in
  parallel with isolated jj draft workspaces;
- author and freeze a gate before implementation;
- judge every candidate clean-room;
- let the user choose alternatives;
- use raw `jj` for draft isolation and the existing `deccy new` / `deccy record` for graph writes;
- make the manual jj sequence the specification for the future `deccy draft` / `record --from`
  and a batch skeleton verb.

## Skills

| ID | Role | Contents |
|---|---|---|
| `deccy-core` | everyone | model, invariants, placement, CLI map, diagnostic scripts |
| `deccy-round` | planner, orchestrator | layer plan, skeleton pass, component partition, phases, jj-direct workspace protocol, failure handling |
| `deccy-author` | drafter | one decision in a frozen-gate draft, custody, evidence |
| `deccy-gate` | gate author | evaluation design, eval matrix, red/green, freeze |
| `deccy-judge` | judge | clean-room base-red/candidate-green, gate integrity, counterexamples, gate-strength advisory |

All five set `opencode/autoinvoke: false`, `disable-model-invocation: true` and Codex's
`agents/openai.yaml` policy `allow_implicit_invocation: false`; the agent prompts load the skills
they need explicitly.

## Agents

| ID | Mode | Use |
|---|---|---|
| `deccy-plan` | all | produce one layer plan (breadth only); read-only |
| `deccy-orchestrator` | all | run the round; only graph writer |
| `deccy-gate-author` | subagent | write one evaluation + red test |
| `deccy-drafter` | subagent | implement one decision |
| `deccy-judge` | subagent | judge a candidate |

Start with `deccy-plan` to get a layer plan, then `deccy-orchestrator` to execute it (or start
`deccy-orchestrator` directly and let it spawn `deccy-plan`). The
orchestrator launches the other three roles. The plan’s separate prose/alternatives **reviewer**
is deliberately not a role yet; the judge checks correctness and the orchestrator/user review the
prose after the verdict. Add it once the round is stable.

OpenCode and Claude Code select these agent files directly. Codex has no `--agent` flag and no
custom agent type in its V2 spawn surface, so `codex/deccy-codex` starts the two root roles and a
spawned child binds its role with `deccy-codex register <task_name>`; see
[`codex/README.md`](codex/README.md). Pi loads the agent files from `~/.pi/agent/agents/` or
`<project>/.pi/agents/` and starts a root role with `pi/deccy-pi`; see
[`pi/README.md`](pi/README.md). All four ports cover the five roles.

## The round in one screen

```text
layer plan / user approval
  -> plan checks (edges, licences, forks, size)
  -> skeleton pass: ALL decision + gate skeletons, in dependency order, one stack
  -> handle map (U1..Un, G1..Gn -> change ids)
  -> partition into components
  -> per component, in parallel:
       gate drafts (author parallel across components, record serial) -> freeze
       implementation drafts (parallel / alternatives)
       judge clean-room (base red, candidate green)
       user chooses -> land -> refresh every other open workspace
  -> validate + topology + custody
```

A **layer** is the set of nodes the planner proposes for the next frontier. It is one table, one row
per node: `new` or `refine <id>`, the decision in one sentence, its prerequisites, its gate action,
the paths it may write, any fork, and the recorded clause that licenses it. The planner does not
design gates or write red commands; the gate author derives the form from the evaluation matrix.

A **component** is a weakly connected set of planned units over their `depends_on` edges. Components
share no plan edge and no write path, so they run in parallel; units inside a component run in
dependency order. The whole layer is one round: one approval, one skeleton pass, one ledger, one
close.

The gate is authored and frozen **before** a drafter starts. The judge runs the gate in its own
workspaces at the decision node, not in the drafter’s workspace. Nothing is recorded before the
judge reports; a rejected candidate never enters the graph.

## New and refine units

A unit is either:

- **`new`** — one new decision node. The implementation draft is based at the frozen gate
  evaluation, so the gate test is already in the tree.
- **`refine <existing id>`** — an edit to an existing decision. The draft is based at the existing
  target, so it carries the target’s current node and refs. The gate paths are restored into the
  draft for running but are **not landable**; the landable set is the draft diff minus the gate
  paths. A refine does not create a decision node. It may add a `depends_on` edge to the target.

A refine reuses its existing evaluation when it still covers the use, amends it in a gate draft
first, or adds a new evaluation for an edge it adds. A new edge needs I4 coverage, so the plan's
gate action is `amend` or `new`, never `reuse` unless the existing evaluation already covers the
edge. The new prerequisite must already precede the target in history; a refine must not plan an
inversion (the skeleton restack is for gate placement, not a refine edge). If the change needs a
different commitment or a new node, it is a `new` unit, not a refine.

## jj-direct draft protocol

Drafts are ordinary jj workspaces under an external root:

```sh
ROOT="$HOME/.local/share/deccy/agent"
WS="$ROOT/workspaces/drafts/<round>/<component>/<handle>"
jj workspace add "$WS" --name "deccy-<round>-<component>-<handle>" -r <base-change-id>
```

The root is fixed because the agents’ edit permissions are scoped to it. Moving it
requires editing those permissions in `opencode/agents/`, `claude/hooks/deccy-guard.py`,
`codex/hooks/deccy-guard.py` and `pi/agents/`.

The workspace’s `@` is the draft. Edit in place; never run `jj new` inside it. Run jj from inside
the workspace (`cd "$WS" && jj ...`), not with `-R` from the trunk.

Landing is the manual version of `record --from`:

```sh
cd "$WS" && jj status
DRAFT=$(cd "$WS" && jj log -r @ --no-graph -T 'change_id.shortest(8)')
PATHS=$(cd "$WS" && jj diff --summary -r @ | sed -n 's/^[A-Z] //p')

cd <repo-root>
jj new <target>
[ -n "$PATHS" ] && jj restore --from "$DRAFT" --to @ -- $PATHS
[ -n "$PATHS" ] && deccy record $PATHS --to <target>
jj workspace forget "deccy-<round>-<component>-<handle>"
jj new <target>
```

The path list travels as arguments. Never pipe it through a wrapper (`xargs`, `sh -c`, `env`, …):
Claude and Codex deny a wrapper's command, and Pi floors any wrapper to a permission prompt on every
call, so it cannot be pre-approved by the role policy. The `[ -n ... ]` test is not cosmetic — an
empty list would turn `jj restore --from <id> --to @ --` into a restore of the whole change.

For a **refine**, base the workspace at the existing target and restore the gate paths for
running; land only the landable set:

```sh
jj workspace add "$WS" --name "deccy-<round>-<component>-<handle>" -r <target-id>
cd "$WS"
[ -n "$GATE_PATHS" ] && jj restore --from "$EVAL_ID" --to @ -- $GATE_PATHS
# edit the existing node + refs; run the gate
PATHS=$(jj diff --summary -r @ | sed -n 's/^[A-Z] //p')
LANDABLE_PATHS=$(printf '%s\n' "$PATHS" | grep -vxF -f <(printf '%s\n' "$GATE_PATHS" | sed '/^$/d') || true)
# land only LANDABLE_PATHS; gate paths stay in the evaluation
# the subtraction uses bash/zsh process substitution
```

`jj workspace forget` removes the workspace, but not reliably its working-copy commit: a draft
forgotten while it still carried content can survive as an empty head. After every draft is
forgotten, run `skills/deccy-round/scripts/abandon-empty-heads.sh`; it abandons only heads that
are empty, undescribed, unbookmarked, not an open workspace’s working copy, and not a node’s own
change, and requires one head afterwards.
Never run `jj abandon` directly. Use `jj workspace update-stale` after a trunk move; a conflict
means the draft is stale and should be rebuilt from the current gate.

`deccy record` checks ownership against the target’s **current** document. The role author writes
the full node with its `content.ref`; a refine starts from the target’s current refs. If a draft
adds a new path, record the node file first (it updates `ref`), then record the new path; do not
`jj squash` around the refusal.

See `skills/deccy-round/references/jj-direct.md` for the allowed/forbidden surface.

## Install

`skills/` is shared at the root. Each integration has its own `link.sh` and `install.sh`:

| Port | Files | Root roles |
|---|---|---|
| OpenCode | `opencode/agents/`, `opencode/install.sh`, `opencode/link.sh` | `deccy-plan`, `deccy-orchestrator` |
| Claude Code | `claude/agents/`, `claude/install.sh`, `claude/link.sh` | same |
| Codex | `codex/install.sh`, `codex/link.sh`, `codex/deccy-codex`, five role prompts | same |
| Pi | `pi/agents/`, `pi/extensions/`, `pi/deccy-pi`, `pi/install.sh`, `pi/link.sh` | same |

Codex children are spawned natively, so it ships role prompts rather than agent files. Pi ships the
five agent files, a role-enforcement extension and a launcher; see [`pi/README.md`](pi/README.md)
for the locked plugin combination and the extra package/approval rules.

```sh
# OpenCode
curl -fsSL https://raw.githubusercontent.com/edawise/deccy-agent/main/opencode/install.sh | sh
# Claude Code
curl -fsSL https://raw.githubusercontent.com/edawise/deccy-agent/main/claude/install.sh | sh
# Codex
curl -fsSL https://raw.githubusercontent.com/edawise/deccy-agent/main/codex/install.sh | sh
# Pi
curl -fsSL https://raw.githubusercontent.com/edawise/deccy-agent/main/pi/install.sh | sh
```

Each installer clones the bundle to `~/.local/share/deccy/agent/bundle` (shared by all four
integrations) and runs that folder's `link.sh`. The Codex integration requires Codex CLI `0.167.0`
or newer and `install.sh` refuses an older release; see [`codex/README.md`](codex/README.md) for the
trust step and upgrade notes. The Pi integration requires Pi `1.0.0` or newer and installs the
pinned Pi packages (with `--no-ask` to skip the optional question tool and `--no-packages` to skip
all package checks); see [`pi/README.md`](pi/README.md). Options: `--project <dir>` for a
project-local install, `--ref <branch|tag>`, `--from <dir>` to use an existing checkout in place,
`--list`, `--uninstall`, and `--purge` (also removes the bundle clone once no links into it
remain). `REPO_URL`, `DEST_BUNDLE`, `DEST_SKILLS` and `DEST_AGENTS` override the default locations;
the Codex `link.sh` also accepts `DEST_HOOKS` and `DEST_BIN`, and the Pi `link.sh` also accepts
`DEST_EXTENSIONS` and `DEST_BIN`.

From a local clone, run `link.sh` directly (`<tool>` is `opencode`, `claude`, `codex` or `pi`):

```sh
./<tool>/link.sh                        # global install
./<tool>/link.sh --project <dir>        # project-local install
./<tool>/link.sh --list                 # show the links and their targets
./<tool>/link.sh --uninstall            # remove only symlinks into this bundle
```

`link.sh` symlinks the five skill directories from `skills/`; OpenCode, Claude Code and Pi also link
the five agent files from `<tool>/agents/`. The Codex `link.sh` links the `deccy-codex` launcher and
registers its hook; the Pi `link.sh` links the `deccy-pi` launcher and the `deccy-role.ts`
extension, installs the pinned packages and prepares the deccy session root. It never copies and
refuses to replace files or links it did not create, so `git pull` updates stay live without
re-linking. The Claude `link.sh` registers (and with `--uninstall` removes) the guard hook in Claude
Code's settings; the Codex `link.sh` registers it in `hooks.json`. See `claude/README.md`,
`codex/README.md` and `pi/README.md`. For `--project` in a jj-managed repository, add
`.opencode/`, `.claude/`, `.agents/` and `.codex/`, or `.pi/`, to `.gitignore` before linking so jj
does not snapshot and clean up the symlinks during round operations (or use the global install).

See [`opencode/README.md`](opencode/README.md), [`claude/README.md`](claude/README.md),
[`codex/README.md`](codex/README.md) and [`pi/README.md`](pi/README.md) for tool-specific paths,
invocation, session setup and enforcement.

Use a fixture repository first. This bundle has not been hardened against a large graph (hundreds of
nodes).

## Current limitations

- **Subagent cwd.** None of OpenCode’s `subagent`, Claude Code’s `Agent`, Codex’s `spawn_agent` or
  Pi’s `subagent` has a `cwd` parameter; children inherit the parent session’s directory. Launch
  primary sessions from the graph repository root (a global Pi install starts in the directory you
  launch it from, and falls back to the neutral deccy root when that directory holds a
  `deccy-*.md` agent file); the role prompts require absolute workspace paths and `cd` for shell
  commands, and the edit permissions are scoped to the draft/judge roots.
- **Pi is unguarded without the launcher.** Pi has no built-in permission system, so the port
  depends on `@gotgenes/pi-permission-system`, and root role policy requires `deccy-pi` (or an
  explicit `DECCY_ROLE` plus `deccy-role.ts`). A plain `pi` session has no deccy role and only the
  user's own configuration. The guard is still a policy guard, not a sandbox: it scopes tool calls,
  not process filesystem access or reads.
- **Pi project agents override the role.** A project-local `.pi/agents/deccy-*.md` with the same
  name replaces the global role body and `permission:` block in children, even when the root runs
  with `--no-approve`. A global Pi install therefore warns and falls back to the neutral deccy root
  when it finds such a file in the launch directory; a project install trusts that project's `.pi/`
  files. Do not run a project-installed root in an untrusted repository.
- **Pi unknown subagent types.** `@gotgenes/pi-subagents` falls back to `general-purpose` for an
  unrecognized `subagent_type`; `deccy-role.ts` blocks it, and a global install also disables the
  fallback agent in the neutral deccy cwd, which covers a session that runs from there. The
  extension gate is the layer that always applies.
- **Pi permission frontmatter widens global policy.** Each `deccy-*` agent file sets
  `external_directory: allow` and `path: allow` so the round can read caches and write under the
  agent root. That deliberately overrides the user's global policy for those five agent names;
  per-tool path maps, ordered bash patterns and skill rules still enforce the role boundary.
- **Pi state roots must be canonical.** Role patterns are `~`-anchored, but the permission system
  matches canonicalized tool paths. If `$HOME` or the agent root is reached through a symlink
  (macOS `TMPDIR` is `/var/...` → `/private/var/...`), an allowed write can be denied against
  `"*"`. Use `pwd -P` when setting `DECCY_AGENT_ROOT`; see
  [`pi/README.md`](pi/README.md#changing-the-state-root).
- **Pi packages are pinned and mutually exclusive.** The port is written against
  `@gotgenes/pi-subagents@25.0.5` and `@gotgenes/pi-permission-system@42.0.0` (optional
  `@juicesharp/rpiv-ask-user-question@2.15.0`). Do not install `nicobailon/pi-subagents`,
  `@tintinweb/pi-subagents` or `@gotgenes/pi-subagents-worktrees` alongside them; `pi/link.sh`
  refuses a conflicting package. Re-run the extension tests and a fixture round after upgrading
  Pi or a package; see [`pi/README.md`](pi/README.md#upgrading-pi).
- **Pi `ask_user_question` is optional.** It requires the optional package and an interactive
  session; in `-p`/JSON runs the planner and orchestrator ask in their final message instead.
- **Codex role binding.** Codex’s V2 `spawn_agent` cannot select a custom agent type, so children
  are bound to a role by a role-prefixed task name and the `deccy-codex register <task_name>`
  handshake. The guard enforces the binding, but it is not cryptographic identity. Spawned children
  inherit the parent’s sandbox and filesystem access; the guard scopes writes, not reads or
  sandboxing.
- **Codex hook trust.** Codex runs non-managed hooks only after `/hooks` trust, and a project
  `.codex/` layer must also be trusted. Without that trust only the role prompts enforce the
  boundaries. Automation needs `--dangerously-bypass-hook-trust`; see
  [`codex/README.md`](codex/README.md#hook-trust-hooks).
- **Codex version.** The Codex port targets CLI `0.167.0` and newer. Hook payloads, tool names and
  V2 spawn arguments are not a stable public API, so an upgrade can silently break the guard or the
  registration handshake. Re-run the guard tests and a one-unit fixture round after upgrading, and
  see [`codex/README.md`](codex/README.md#upgrading-codex).
- **Refine units.** A refine draft is based at the existing target and restores the gate paths for
  running. The landable set is the draft diff minus those paths; the orchestrator must subtract
  them and never record them into the target. If the refine adds a new `ref`, the node JSON is
  recorded first, then the new path. A refine may add the `depends_on` edge the plan names, with a
  gate that covers it; a refine that needs a different decision or a new node is a `new` unit.
- **Gate history.** The gate’s position in jj history depends on creation order: `deccy new`
  positions at the unique head of its `--on` set, so the gate may sit above the decision. The gate
  is still authored and frozen before implementation, but history does not yet guarantee “gate
  before decision”; the final `--after` does. The judge’s clean-room run is the acceptance
  evidence.
- **Linear skeleton stack.** `deccy new` always positions after the unique head of its `--on` set,
  so one skeleton pass produces one linear stack. Every gate or implementation record rebases
  everything above it; every open workspace must be refreshed with `jj workspace update-stale` and
  its gate re-run before the verdict is trusted. A future `deccy new --after` (sibling placement)
  and a batch skeleton verb remove most of that churn; until then keep a layer within
  `max_units_per_layer` (default 12). A component is a plan-level partition, not yet a separate
  jj stack.
- **Gate authoring is parallel, recording is serial.** Gate drafts base at their own evaluation
  nodes and can be written concurrently, but the graph write cannot: recording one gate stales the
  other open workspaces. The orchestrator records one at a time and refreshes every workspace.
- **Bounds and barrier are advisory.** The orchestrator enforces `max_units_per_layer`,
  `max_open_drafts` and `round_barrier`; the CLI does not yet. The round state lives in
  `~/.local/share/deccy/agent/rounds/`, not in `.deccy/work/`.
- **Forks are resolved before skeletons.** A fork (`A …` / `B …`) changes the content of its
  dependants, and all skeletons are created before any workspace opens, so an unchosen fork's
  dependants belong to the next layer. There is no second skeleton pass while drafts are open.
- **No graph verdicts.** Judge verdicts and red/green evidence stay in the round report; the
  evaluation node describes only the check (I5).
- **Gate strength is advisory.** The judge reports a weak gate (no base-red, a plausible wrong
  candidate passing, an ungrounded check) as `gate-weak`; it does not veto the candidate. The user
  decides whether to accept the weak gate or ask the gate author to amend it. Gate **integrity**
  failures (hash, gate edits, substituted command) still block.
- **Custody check.** Run `check-ref-custody.py` only when no draft workspaces are open; a draft
  intentionally edits files outside its target’s ownership until landing.
- **Empty heads after forget.** `jj workspace forget` can leave an empty head (observed in a past
  round). The orchestrator now runs the verified `abandon-empty-heads.sh` at close; a
  remaining non-empty or bookmarked head still stops the round for a human decision.
- **Empty internal changes.** A restack can leave a described or undescribed empty change below the
  tip. It is harmless: `set-round-tip.sh` moves `@` above the highest landed node change, and close
  requires one head, not zero empty internal changes. Do not rebase or abandon it just to make the
  log look shorter.
