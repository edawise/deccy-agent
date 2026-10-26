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

All five set `opencode/autoinvoke: false`; the agent prompts load exactly the skills they need.

## Agents

| ID | Mode | Use |
|---|---|---|
| `deccy-plan` | all | produce one layer plan (breadth only); read-only |
| `deccy-orchestrator` | all | run the round; only graph writer |
| `deccy-gate-author` | subagent | write one evaluation + red test |
| `deccy-drafter` | subagent | implement one decision |
| `deccy-judge` | subagent | judge a candidate |

Start with `deccy-plan` to get a layer plan, then `deccy-orchestrator` to execute it. The
orchestrator launches the other three roles. The plan’s separate prose/alternatives **reviewer**
is deliberately not a role yet; the judge checks correctness and the orchestrator/user review the
prose after the verdict. Add it once the round is stable.

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
edge. The new prerequisite must already precede the target in history; the round cannot rebase. If
the change needs a different commitment or a new node, it is a `new` unit, not a refine.

## jj-direct draft protocol

Drafts are ordinary jj workspaces under an external root:

```sh
ROOT="$HOME/.local/share/deccy/agent"
WS="$ROOT/workspaces/drafts/<round>/<component>/<handle>"
jj workspace add "$WS" --name "deccy-<round>-<component>-<handle>" -r <base-change-id>
```

The root is fixed because the agents’ edit permissions are scoped to it. Moving it
requires editing those permissions in `agents/`.

The workspace’s `@` is the draft. Edit in place; never run `jj new` inside it. Run jj from inside
the workspace (`cd "$WS" && jj ...`), not with `-R` from the trunk.

Landing is the manual version of `record --from`:

```sh
cd "$WS" && jj status
DRAFT=$(cd "$WS" && jj log -r @ --no-graph -T 'change_id.shortest(8)')
PATHS=$(cd "$WS" && jj diff --summary -r @ | sed -n 's/^[A-Z] //p')

cd <repo-root>
jj new <target>
printf '%s\n' "$PATHS" | xargs -r jj restore --from "$DRAFT" --to @ --
printf '%s\n' "$PATHS" | xargs -r deccy record --to <target>
jj workspace forget "deccy-<round>-<component>-<handle>"
jj new <target>
```

For a **refine**, base the workspace at the existing target and restore the gate paths for
running; land only the landable set:

```sh
jj workspace add "$WS" --name "deccy-<round>-<component>-<handle>" -r <target-id>
cd "$WS"
printf '%s\n' "$GATE_PATHS" | xargs -r jj restore --from "$EVAL_ID" --to @ --
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

## Link into OpenCode

The script symlinks each skill directory and agent file into OpenCode; it does not copy.

```sh
./link.sh                       # global: ~/.config/opencode/{skills,agents}
./link.sh --project <dir>       # <dir>/.opencode/{skills,agents}
./link.sh --uninstall           # remove only symlinks into this bundle
```

Then check:

```sh
opencode debug agents | grep deccy
ls -la ~/.config/opencode/skills/deccy-*
```

Run one:

```sh
opencode run --agent deccy-plan "Plan the next layer for <request>"
opencode run --agent deccy-orchestrator "Execute the approved layer plan"
```

Use a fixture repository first. This bundle has not been hardened against a large graph (hundreds of
nodes).

## Current limitations

- **Subagent cwd.** OpenCode’s built-in `subagent` tool has no `cwd` parameter; children inherit
  the parent session’s directory. The role prompts therefore require absolute workspace paths and
  `cd` for shell commands, and the edit permissions are scoped to the draft/judge roots. A bridge
  plugin or `opencode run` in the workspace is the next step.
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
